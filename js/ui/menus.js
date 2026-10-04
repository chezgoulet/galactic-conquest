// Main menu + galactic campaign map + post-match overlay. UI only (browser).
// The menu owns the #ui overlay; when a battle starts it hands the overlay to
// the Game and returns to render when the match ends. Campaign state persists
// to localStorage so a player can resume their front.
(function (E) {
  'use strict';

  const LS_KEY = 'gc.campaign.v1';
  const LS_SET = 'gc.settings.v1';

  class Menu {
    constructor(root) {
      this.root = root;
      this.campaign = this.load() || null;
      this.settings = this.loadSettings();
      this.onStart = null;   // set by main.js: (opts) => void
      this._hidden = false;
    }

    load() { try { const s = localStorage.getItem(LS_KEY); return s ? JSON.parse(s) : null; } catch { return null; } }
    save() { try { if (this.campaign) localStorage.setItem(LS_KEY, JSON.stringify(this.campaign)); } catch {} }
    loadSettings() { try { const s = localStorage.getItem(LS_SET); return Object.assign({ faction: 'aegis' }, s ? JSON.parse(s) : {}); } catch { return { faction: 'aegis' }; } }
    saveSettings() { try { localStorage.setItem(LS_SET, JSON.stringify(this.settings)); } catch {} }

    hide() { this._hidden = true; this.root.innerHTML = ''; }
    show() { this._hidden = false; this.render(); }

    // ── main menu ──────────────────────────────────────────────
    render() {
      const T = E.faction;
      this.root.innerHTML = `
      <div class="menu gc-menu">
        <div class="menu-card">
          <div class="menu-title">GALACTIC CONQUEST</div>
          <div class="menu-sub">A war across the stars, fought on land, in the air, and in the void. Built entirely from code.</div>

          <div class="menu-row">
            <div class="menu-label">Command</div>
            <div class="seg" id="gc-fac">
              <button data-fac="aegis" class="${this.settings.faction === 'aegis' ? 'on' : ''}">Aegis Concord</button>
              <button data-fac="verdant" class="${this.settings.faction === 'verdant' ? 'on' : ''}">Verdant Pact</button>
            </div>
          </div>

          <div class="menu-row">
            <button class="gc-btn primary gc-campaign" style="flex:1">Galactic Campaign ${this.campaign ? `· ${this.campaign.systems.length - 2} systems` : ''}</button>
            <button class="gc-btn gc-quick" style="flex:1">Quick Battle</button>
          </div>

          <div class="menu-row">
            <button class="gc-btn gc-mp" style="flex:1" disabled>Multiplayer <span class="gc-dim">— coming online</span></button>
          </div>

          <div class="gc-controls" id="gc-controls">
            <div class="gc-controls-head">CONTROLS</div>
            <div>Left-click select · Left-drag box-select · Right-click attack-move</div>
            <div><b>F</b> board nearest unit · <b>V</b> drive selected · <b>C/Esc</b> release to commander view</div>
            <div>WASD move · Mouse look (on foot / in a craft) · <b>↑↓←→</b> orbit the commander view · <b>Shift</b> boost</div>
            <div>Hold to capture objectives · Destroy the enemy HQ to win</div>
          </div>
        </div>
      </div>`;
      this.bind();
    }

    bind() {
      const q = (s) => this.root.querySelector(s);
      this.root.querySelectorAll('#gc-fac button').forEach(b => b.addEventListener('click', () => {
        this.settings.faction = b.dataset.fac; this.saveSettings();
        this.root.querySelectorAll('#gc-fac button').forEach(x => x.classList.toggle('on', x === b));
      }));
      const c = q('.gc-campaign'); if (c) c.addEventListener('click', () => this.showCampaign());
      const qk = q('.gc-quick'); if (qk) qk.addEventListener('click', () => this.quick());
    }

    // ── quick battle: pick a biome, fight AI ───────────────────
    quick() {
      const biomes = E.BIOME_LIST;
      const btn = (id, d) => `<button class="gc-btn gc-biome" data-biome="${id}">${d.theme}<span class="gc-dim"> · ${d.name}</span></button>`;
      this.root.innerHTML = `
      <div class="menu gc-menu">
        <div class="menu-card">
          <div class="menu-title">QUICK BATTLE</div>
          <div class="menu-sub">Pick a world. Each biome has an inherent challenge.</div>
          <div class="gc-biome-grid">
            ${biomes.map(d => btn(d.id, d)).join('')}
          </div>
          <div class="menu-row" style="margin-top:14px"><button class="gc-btn gc-back">Back</button></div>
        </div>
      </div>`;
      this.root.querySelectorAll('.gc-biome').forEach(b => b.addEventListener('click', () => {
        const r = E.Campaign.quickBattle({ seed: E.RNG(1).i(1e9), human: this.settings.faction });
        r.biome = b.dataset.biome;
        r.system = E.biome(b.dataset.biome).name;
        this.begin(r, null);
      }));
      const back = this.root.querySelector('.gc-back'); if (back) back.addEventListener('click', () => this.render());
    }

    // ── galactic campaign map ──────────────────────────────────
    showCampaign() {
      if (!this.campaign) this.campaign = E.Campaign.newCampaign({ playerFaction: this.settings.faction, seed: E.RNG(1).i(1e9) });
      const c = this.campaign;
      const opts = E.Campaign.matchOptions(c);
      const front = E.Campaign.frontSystem(c);
      const bdef = E.biome(front.biome);
      const nodes = c.systems.map((s, i) => {
        const cls = s.owner === c.playerFaction ? 'aegis' : s.owner === c.enemyFaction ? 'verdant' : 'neutral';
        const isFront = i === c.frontIndex && !c.victory;
        return `<div class="gc-node ${cls}${isFront ? ' front' : ''}" title="${s.name}">
          <div class="gc-node-dot"></div>
          <div class="gc-node-name">${s.name}</div>
          <div class="gc-node-biome">${E.biome(s.biome).theme}</div>
        </div>`;
      }).join('');
      this.root.innerHTML = `
      <div class="menu gc-menu">
        <div class="menu-card gc-galaxy-card">
          <div class="menu-title">GALACTIC CAMPAIGN</div>
          <div class="menu-sub">Drive the war from your home to the enemy's. Capture the front system to advance.</div>
          <div class="gc-galaxy">${nodes}</div>
          <div class="gc-galaxy-link"></div>
          <div class="gc-front">
            <div><span class="gc-dim">FRONT SYSTEM</span><b> ${front.name}</b></div>
            <div><span class="gc-dim">WORLD</span> ${bdef.theme} — ${bdef.challenge.name}</div>
            <div class="gc-front-chal">${bdef.desc}</div>
            <div><span class="gc-dim">YOUR FLEET</span> ${E.Campaign.fleetScale(c).toFixed(2)}x · Resources ${c.resources}</div>
          </div>
          <div class="menu-row" style="margin-top:14px">
            <button class="gc-btn primary gc-attack" style="flex:1">Deploy to ${front.name}</button>
            <button class="gc-btn gc-reset">Restart Campaign</button>
            <button class="gc-btn gc-back">Back</button>
          </div>
          ${c.victory ? `<div class="gc-victory">THE ${E.faction(c.victory).name.toUpperCase()} HAS CONQUERED THE GALAXY</div>` : ''}
        </div>
      </div>`;
      const atk = this.root.querySelector('.gc-attack');
      if (atk) atk.addEventListener('click', () => this.begin(opts, c));
      const rst = this.root.querySelector('.gc-reset');
      if (rst) rst.addEventListener('click', () => { this.campaign = E.Campaign.newCampaign({ playerFaction: this.settings.faction, seed: E.RNG(1).i(1e9) }); this.save(); this.showCampaign(); });
      const back = this.root.querySelector('.gc-back'); if (back) back.addEventListener('click', () => this.render());
    }

    // begin a battle: opts is match options, c is the campaign (or null for quick)
    begin(opts, c) {
      if (this.onStart) this.onStart(opts, c);
    }
  }

  E.Menu = Menu;
  E.LS_KEY = LS_KEY;
})(window.E = window.E || {});
