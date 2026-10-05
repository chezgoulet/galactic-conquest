// Portable save envelope. The game keeps its settings, career profile, campaign
// and war-log in localStorage under versioned keys; this bundles all of them into
// one versioned JSON document so a player can back them up or move between
// browsers. Pure and browser-free where it can be (the localStorage and download
// helpers are guarded), so the round-trip is unit-testable in Node.
(function (E) {
  'use strict';
  const VERSION = 1, APP = 'galactic-conquest', FILENAME = 'galactic-conquest-save.json';
  const KEYS = { settings: 'gc.settings.v2', profile: 'gc.profile.v1', campaign: 'gc.campaign.v2', history: 'gc.camp.hist.v1' };

  function readLS(k) { try { const s = localStorage.getItem(k); return s ? JSON.parse(s) : null; } catch (e) { return null; } }
  function writeLS(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }

  function envelope() {
    return { app: APP, version: VERSION, exported: Date.now(), data: { settings: readLS(KEYS.settings), profile: readLS(KEYS.profile), campaign: readLS(KEYS.campaign), history: readLS(KEYS.history) } };
  }
  function exportString() { return JSON.stringify(envelope(), null, 2); }

  // Validate and split an envelope; throws on anything that is not ours or is
  // from a newer build. Leaves the caller to merge/apply and persist.
  function parse(str) {
    let o; try { o = JSON.parse(str); } catch (e) { throw new Error('That file is not valid JSON.'); }
    if (!o || o.app !== APP) throw new Error('That is not a Galactic Conquest save.');
    if ((o.version | 0) > VERSION) throw new Error('That save is from a newer version of the game.');
    const d = (o.data && typeof o.data === 'object') ? o.data : {};
    return { settings: d.settings || null, profile: d.profile || null, campaign: d.campaign || null, history: d.history || null };
  }
  // Parse and write into localStorage. Returns the split data for the caller.
  function importString(str) {
    const d = parse(str);
    writeLS(KEYS.settings, d.settings); writeLS(KEYS.profile, d.profile);
    writeLS(KEYS.campaign, d.campaign); writeLS(KEYS.history, d.history);
    return d;
  }

  // ── browser helpers (no-ops without a DOM) ──────────────────
  function download(name) {
    if (typeof document === 'undefined' || typeof URL === 'undefined' || !URL.createObjectURL) return false;
    const blob = new Blob([exportString()], { type: 'application/json' });
    const url = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = url; a.download = name || FILENAME; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return true;
  }
  function pick(cb) {
    if (typeof document === 'undefined') return false;
    const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'application/json,.json';
    inp.onchange = () => {
      const f = inp.files && inp.files[0]; if (!f) return;
      const r = new FileReader();
      r.onload = () => { try { cb(importString(String(r.result))); } catch (e) { cb(null, e); } };
      r.readAsText(f);
    };
    inp.click();
    return true;
  }

  E.Save = { VERSION, APP, FILENAME, KEYS, envelope, exportString, parse, importString, download, pick };
})(window.E = window.E || {});
