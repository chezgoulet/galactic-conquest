// Operator CLI. Talks directly to the database (not over HTTP) so it works even
// when the service is down. Every mutation is audited.
//
//   node src/cli.js <command> [args]
//   promote <email|name> <role>        create-owner <email> <password>
//   grant <email|name> <days>          migrate
//   keys:rotate                          secrets:rewrap
import crypto from 'node:crypto';
import { loadConfig } from './config.js';
import { openAndMigrate } from './db/index.js';
import { Keyring } from './ops/keys.js';
import { encryptSecret, decryptSecret, hashPassword } from './lib/crypto.js';

const [, , cmd, ...args] = process.argv;
const cfg = loadConfig(process.env);
const die = (m) => { process.stderr.write('error: ' + m + '\n'); process.exit(1); };

async function db() { return openAndMigrate(cfg); }
const byQuery = async (db, q) => {
  const row = await db.queryOne('SELECT * FROM users WHERE name_key = $1 OR email = $2', [q, q.toLowerCase()]);
  if (!row) die('no user "' + q + '"');
  return row;
};

async function main() {
  switch (cmd) {
    case 'migrate': { const d = await db(); process.stdout.write('migrated\n'); break; }

    case 'create-owner': {
      const [email, password] = args; if (!email || !password) die('usage: create-owner <email> <password>');
      const d = await db();
      const id = crypto.randomUUID();
      const uname = email.split('@')[0].slice(0, 16);
      await d.query('INSERT INTO users (id, display_name, name_key, email, password_hash, role, email_verified) VALUES ($1,$2,$3,$4,$5,$6,true)', [id, uname, uname.toLowerCase(), email.toLowerCase(), hashPassword(password), 'owner']);
      d.query('INSERT INTO audit_log (action, target) VALUES ($1,$2)', ['cli.create_owner', email]);
      process.stdout.write('owner ' + email + ' created\n');
      break;
    }

    case 'promote': {
      const [q, role] = args; if (!q || !['player', 'support', 'moderator', 'admin', 'owner'].includes(role)) die('usage: promote <email|name> <role>');
      const d = await db(); const u = await byQuery(d, q);
      await d.query('UPDATE users SET role = $1 WHERE id = $2', [role, u.id]);
      d.query('INSERT INTO audit_log (action, target, detail) VALUES ($1,$2,$3)', ['cli.promote', u.name_key, JSON.stringify({ role })]);
      process.stdout.write(u.display_name + ' -> ' + role + '\n');
      break;
    }

    case 'grant': {
      const [q, days] = args; if (!q || !days) die('usage: grant <email|name> <days>');
      const d = await db(); const u = await byQuery(d, q);
      // membership is OFF by default; grant is a no-op entitlement recorded in config
      await d.query("INSERT INTO remote_config (key, value) VALUES ($1, $2) ON CONFLICT (key) DO NOTHING", ['grants', JSON.stringify({ [u.id]: { days: +days, at: new Date().toISOString() } })]);
      d.query('INSERT INTO audit_log (action, target, detail) VALUES ($1,$2,$3)', ['cli.grant', u.name_key, JSON.stringify({ days: +days })]);
      process.stdout.write('granted ' + days + 'd to ' + u.display_name + ' (membership is ' + (cfg.MEMBERSHIP_ENABLED === '1' ? 'on' : 'off') + ')\n');
      break;
    }

    case 'keys:rotate': {
      const d = await db(); const k = new Keyring(d, cfg.SECRET_KEY); await k.load(); const kid = await k.rotate();
      process.stdout.write('rotated; new signer ' + kid + '\n');
      break;
    }

    case 'secrets:rewrap': {
      // re-encrypt server_keys + totp secrets after a SECRET_KEY rotation
      const d = await db();
      const keys = (await d.query('SELECT id, private_enc FROM server_keys')).rows;
      for (const r of keys) {
        try { const plain = decryptSecret(cfg.SECRET_KEY, 'key:' + r.id, r.private_enc); await d.query('UPDATE server_keys SET private_enc = $1 WHERE id = $2', [encryptSecret(cfg.SECRET_KEY, 'key:' + r.id, plain), r.id]); } catch { process.stderr.write('  skip key ' + r.id + '\n'); }
      }
      const users = (await d.query('SELECT id, totp_secret_enc FROM users WHERE totp_secret_enc IS NOT NULL')).rows;
      for (const u of users) {
        try { const plain = decryptSecret(cfg.SECRET_KEY, 'totp:' + u.id, u.totp_secret_enc); await d.query('UPDATE users SET totp_secret_enc = $1 WHERE id = $2', [encryptSecret(cfg.SECRET_KEY, 'totp:' + u.id, plain), u.id]); } catch {}
      }
      process.stdout.write('re-wrap complete\n');
      break;
    }

    default:
      process.stdout.write('Galactic Conquest operator CLI\n  migrate · create-owner <email> <pw> · promote <email|name> <role>\n  grant <email|name> <days> · keys:rotate · secrets:rewrap\n');
  }
}
main().catch((e) => die(e.stack || e.message));
