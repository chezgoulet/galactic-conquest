import { test, after } from 'node:test';
import assert from 'node:assert';
import { boot, cookie, auth } from './helpers.js';

let h;
after(async () => { if (h) await h.close(); });

async function user(name) {
  const su = await h.app.inject({ method: 'POST', url: '/api/auth/signup', payload: { email: name.toLowerCase() + '@ex.com', password: 'password123', name } });
  return { ck: auth(cookie(su)) };
}
const put = (ck, key, value, version) => h.app.inject({ method: 'PUT', url: '/api/cloud/' + encodeURIComponent(key), headers: ck, payload: version != null ? { value, version } : { value } });
const get = (ck, key) => h.app.inject({ method: 'GET', url: '/api/cloud/' + encodeURIComponent(key), headers: ck });
const del = (ck, key) => h.app.inject({ method: 'DELETE', url: '/api/cloud/' + encodeURIComponent(key), headers: ck });

test('cloud saves: put/get/list/delete with optimistic versioning', async () => {
  h = await boot();
  const A = await user('CloudA');
  assert.strictEqual((await h.app.inject({ method: 'GET', url: '/api/cloud' })).statusCode, 401, 'auth required');

  const p1 = await put(A.ck, 'save', { xp: 10 });
  assert.strictEqual(p1.statusCode, 200);
  assert.strictEqual((await p1.json()).version, 1, 'first write is version 1');

  const gd = await (await get(A.ck, 'save')).json();
  assert.deepStrictEqual(gd.value, { xp: 10 });
  assert.strictEqual(gd.version, 1);

  const list = await (await h.app.inject({ method: 'GET', url: '/api/cloud', headers: A.ck })).json();
  assert.deepStrictEqual(list.map((r) => r.key), ['save']);

  const p2 = await put(A.ck, 'save', { xp: 20 }, 1);
  assert.strictEqual((await p2.json()).version, 2, 'a matching version advances');
  assert.strictEqual((await put(A.ck, 'save', { xp: 30 }, 1)).statusCode, 409, 'stale version conflicts');

  assert.strictEqual((await put(A.ck, 'bad key!', {})).statusCode, 400, 'bad key rejected');
  assert.strictEqual((await h.app.inject({ method: 'PUT', url: '/api/cloud/save', headers: A.ck, payload: {} })).statusCode, 400, 'missing value rejected');
  assert.strictEqual((await put(A.ck, 'big', { blob: 'x'.repeat(300000) })).statusCode, 400, 'oversize rejected');

  assert.strictEqual((await del(A.ck, 'save')).statusCode, 200);
  assert.strictEqual((await get(A.ck, 'save')).statusCode, 404, 'deleted slot is gone');
});

test('cloud saves are isolated per account', async () => {
  const A = await user('CloudB1'), B = await user('CloudB2');
  await put(A.ck, 'save', { who: 'A' });
  assert.strictEqual((await get(B.ck, 'save')).statusCode, 404, "another account cannot read A's save");
});
