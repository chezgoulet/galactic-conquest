// First-run onboarding: a short, dismissible "how to play" card shown once, and
// on demand from the menu or pause screen. Everything it says is also in the
// Codex and the Controls reference; this just makes sure a new player sees the
// four things that actually win a match.
(function (E) {
  'use strict';
  const KEY = 'gc.onboard.v1';
  function seen() { try { return !!localStorage.getItem(KEY); } catch (e) { return true; } }
  function mark() { try { localStorage.setItem(KEY, '1'); } catch (e) {} }

  function show() {
    hide();
    const host = document.getElementById('ui') || document.body;
    const el = document.createElement('div');
    el.className = 'ob-root';
    el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true'); el.setAttribute('aria-label', 'How to play');
    el.innerHTML = `
      <div class="ob-card">
        <div class="ob-title">WELCOME, COMMANDER</div>
        <p class="ob-lead">A conquest battle is fought on land, in the air and in space. Four things decide it:</p>
        <div class="ob-grid">
          <div class="ob-step"><b>1 · Fight</b><p><kbd>WASD</kbd> move, mouse aims, <kbd>LMB</kbd> fires. <kbd>Shift</kbd> sprints, <kbd>Space</kbd> jumps. Use cover — incoming fire suppresses your aim.</p></div>
          <div class="ob-step"><b>2 · Take any unit</b><p>Aim at a friendly soldier, tank, fighter or the flagship and press <kbd>F</kbd> to take it over. <kbd>M</kbd> opens the commander view to order your army.</p></div>
          <div class="ob-step"><b>3 · Win the ground</b><p>Stand inside a command post ring to capture it. Hold more posts than the enemy to drain their reinforcements — every death costs one.</p></div>
          <div class="ob-step"><b>4 · Own the sky</b><p>Fighters and the capital ship duel overhead. Launch, escort, board and knock out subsystems to win space.</p></div>
        </div>
        <div class="ob-ctl" hidden></div>
        <div class="ob-btns">
          <button class="gc-btn ob-controls">View all controls</button>
          <button class="gc-btn primary ob-go">Got it</button>
        </div>
      </div>`;
    host.appendChild(el);
    const close = () => { mark(); hide(); };
    const go = el.querySelector('.ob-go'); if (go) go.focus({ preventScroll: true });
    el.querySelector('.ob-go').addEventListener('click', close);
    el.querySelector('.ob-controls').addEventListener('click', () => {
      const box = el.querySelector('.ob-ctl');
      if (box.hidden) { box.innerHTML = E.ControlsUI.html('infantry'); E.ControlsUI.bind(box); box.hidden = false; el.querySelector('.ob-controls').textContent = 'Hide controls'; }
      else { box.hidden = true; el.querySelector('.ob-controls').textContent = 'View all controls'; }
    });
    el.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); close(); } });
  }
  function hide() { const el = document.querySelector('.ob-root'); if (el) el.remove(); }
  function maybeShow() { if (!seen()) show(); }

  E.Onboarding = { show, hide, maybeShow, seen, mark, KEY };
})(window.E = window.E || {});
