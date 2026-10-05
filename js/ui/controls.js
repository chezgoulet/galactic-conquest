// Every binding, per unit kind. One table feeds the contextual hint bar in the
// HUD and the controls reference screen, so the two can never disagree.
// rows: [keys, what it does]; the hint bar shows the `hint` subset.
(function (E) {
  'use strict';
  const COMMON = [
    ['F', 'Take control of the friendly you aim at'], ['M', 'Command view'], ['Tab', 'Scoreboard'], ['Esc', 'Pause and settings'], ['F1', 'This reference'],
  ];
  const CALL = [['Y', 'Call air support on the point you aim at (bomber or gunship)'], ['U', 'Call a gunship strike on the aim point']];
  const SQUAD = [['Z', 'Squad: follow me'], ['X', 'Squad: move to the aim point'], ['V', 'Squad: dismiss']];
  const C = {
    infantry: { name: 'Infantry', desc: 'Trooper, Heavy, Marksman, Mender and Engineer.',
      rows: [['W A S D', 'Move'], ['Mouse', 'Aim'], ['LMB', 'Fire (heat builds; stop to cool)'], ['RMB', 'Zoom / scope'], ['G or MMB', 'Alternate weapon: frag, launcher, healing pulse, tread mine'], ['Shift', 'Sprint (drains stamina)'],
        ['Space', 'Jump; near cover it vaults or mantles'], ['C', 'Crouch; while sprinting, slide'], ['R', 'Engineer: raise a barricade'], ['T', 'Engineer: cycle tool (gun, repair torch, demolition charge)'], ...SQUAD, ...CALL, ...COMMON],
      hint: [['LMB', 'Fire'], ['G', 'Alt'], ['Shift', 'Sprint'], ['Space', 'Jump/Vault'], ['C', 'Crouch'], ['Z X V', 'Squad'], ['Y', 'Air support'], ['F', 'Take control'], ['M', 'Command']] },
    engineer: { name: 'Engineer', desc: 'Infantry, with tools.', rows: [],
      hint: [['LMB', 'Use tool / fire'], ['T', 'Cycle tool'], ['G', 'Lay mine'], ['R', 'Barricade'], ['Space', 'Vault'], ['Y', 'Air support'], ['F', 'Take control'], ['M', 'Command']] },
    vehicle: { name: 'Hover vehicles', desc: 'Skiff, Bulwark tank and Sentinel anti-air.',
      rows: [['W S', 'Throttle and brake'], ['A D', 'Steer'], ['Mouse', 'Aim the turret (it has a traverse limit on some hulls)'], ['LMB', 'Fire main gun'], ['G or MMB', 'Secondary weapon (coax / Skyhook)'], ['C', 'Handbrake / drift'],
        ['Ram', 'Drive into infantry and light craft: speed is damage'], ...CALL, ...COMMON],
      hint: [['W A S D', 'Drive'], ['LMB', 'Main gun'], ['G', 'Secondary'], ['C', 'Handbrake'], ['Y', 'Air support'], ['F', 'Take control'], ['M', 'Command']] },
    fighter: { name: 'Starfighters', desc: 'Interceptor, bomber, gunship and strike craft.',
      rows: [['Mouse', 'Pitch and yaw'], ['Q E', 'Roll'], ['W S', 'Throttle up and down'], ['Shift', 'Afterburner (energy bar; locks out when empty). Gunship: climb'], ['LMB', 'Guns'], ['G or MMB', 'Missile / bomb / pods / torpedo (hold on target to lock)'], ['T', 'Cycle lock target'],
        ['Space', 'Countermeasures (flares)'], ['C', 'Drift: slide the nose without turning the velocity (gunship: descend / brake)'], ['R', 'Barrel roll (evade)'], ['X', 'Gunship: set the troops down (hover low and slow)'], ['F', 'Switch to another friendly'], ['M', 'Command view'], ['Esc', 'Pause']],
      hint: [['Mouse', 'Steer'], ['W S', 'Throttle'], ['Shift', 'Afterburner'], ['LMB', 'Guns'], ['G', 'Missile / bomb'], ['T', 'Cycle lock'], ['Space', 'Flares'], ['C', 'Drift'], ['R', 'Barrel roll'], ['M', 'Command']] },
    capital: { name: 'Capital ships', desc: 'The bridge of a cruiser, carrier or dreadnought.',
      rows: [['W S', 'Throttle'], ['A D', 'Helm: turn'], ['Mouse', 'Aim the batteries'], ['LMB', 'Fire batteries'], ['G', 'Orbital strike on the aim point (needs a battery and no ground shield)'], ['T', 'Cycle target: ship, then subsystem'], ['R', 'Cycle power preset (balanced, shields, weapons, engines)'], ['1 2 3 4', 'Pick a power preset directly'],
        ['Q E', 'Shift power between shields and weapons'], ['Shift', 'Engine boost'], ['C', 'Brace: heavy damage reduction for a few seconds, then a cooldown'], ['Space', 'Launch the fighter wing'], ['B', 'Launch boarding pods at the selected ship (needs its shields down)'], ['N N', 'Order the ship to retreat (press twice)'], ['F', 'Switch to another friendly'], ['M', 'Command view']],
      hint: [['W A S D', 'Helm'], ['LMB', 'Batteries'], ['G', 'Orbital'], ['T', 'Target'], ['R / 1-4', 'Power'], ['C', 'Brace'], ['Space', 'Launch wing'], ['B', 'Board'], ['N N', 'Retreat'], ['M', 'Command']] },
    boarding: { name: 'Boarding marines', desc: 'Zero-G deck fighting inside an enemy ship.',
      rows: [['W A S D', 'Move'], ['Mouse', 'Aim'], ['LMB', 'Fire'], ['Shift', 'Sprint'], ['Hold a node', 'Standing in a node ring sabotages the matching system; the bridge captures the ship']],
      hint: [['W A S D', 'Move'], ['LMB', 'Fire'], ['Shift', 'Sprint'], ['', 'Hold the glowing nodes']] },
    commander: { name: 'Command view', desc: 'The tactical map: order your army, call in strikes.',
      rows: [['W A S D', 'Pan'], ['Q E', 'Rotate'], ['Wheel', 'Zoom'], ['LMB / drag', 'Select units / box select'], ['RMB', 'Order selected units to move'], ['H', 'Hold position'], ['V', 'Free fire'], ['1 2 3', 'Select all infantry / armor / air'], ['F', 'Take control of the selected unit'],
        ['Call-in buttons', 'Then click the map: bomber, gunship, orbital strike'], ['C or Enter', 'Return to deployment']],
      hint: [['LMB', 'Select'], ['RMB', 'Move order'], ['H', 'Hold'], ['V', 'Free fire'], ['1 2 3', 'Groups'], ['F', 'Take control'], ['Enter', 'Deploy']] },
  };
  C.order = ['infantry', 'engineer', 'vehicle', 'fighter', 'capital', 'boarding', 'commander'];
  // the hint list for what the player is controlling right now
  C.forUnit = function (u, state) {
    if (state === 'commander') return C.commander;
    if (!u) return null;
    if (u.mode === 'boarding') return C.boarding;
    if (u.kind === 'infantry') return u.type === 'engineer' ? C.engineer : C.infantry;
    return C[u.kind] || (u.kind === 'turret' ? C.vehicle : null);
  };
  E.CONTROLS = C;
})(window.E = window.E || {});
