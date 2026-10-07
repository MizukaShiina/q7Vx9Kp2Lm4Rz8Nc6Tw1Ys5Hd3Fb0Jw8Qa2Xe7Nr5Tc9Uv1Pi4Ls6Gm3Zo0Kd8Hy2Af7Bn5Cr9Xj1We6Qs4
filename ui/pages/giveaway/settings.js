/**
 * Giveaway Settings
 * ---------------------------------------------------------------------------
 * Modal controller for giveaway settings.
 *
 * The modal *frame* is static markup in index.html; the field rows are meant
 * to be rendered dynamically from the FIELDS definition below, so adding a
 * setting later requires no hand-written HTML.
 *
 * The scheduler keys get special treatment: they are grouped into a dedicated
 * "Scheduler" section rendered at the top of the modal. The section is a
 * master switch whose body is a collapsible drawer — the sub-options slide
 * open only while the scheduler toggle is on. The sub-field inputs stay in
 * the DOM (clipped, not removed) so their values survive the collapse and are
 * always included when the form is collected on Save.
 *
 * This module is dynamically imported by script.js and exposes `init()`,
 * which (re-)wires the gear toggle and the modal controls. Because the
 * dashboard force-reloads a page by creating a fresh DOM, `init()` rebinds
 * listeners against the current nodes so duplicates can never stack.
 */

// General (non-scheduler) field rows. Built adaptively from the incoming
// giveaway settings state; `type` drives the renderer:
//   { id, label, hint, type: 'text' | 'number' | 'toggle', value }
const FIELDS = [];

// Scheduler section field rows (the master toggle + its drawer sub-options).
const SCHEDULER_FIELDS = [];

// Verification
const WINNER_VERIFICATION_FIELDS = [];

// Keys that belong to the Scheduler section (master switch + its options).
// `winner_per_loop` is intentionally grouped here even though it does not
// carry the `scheduler_` prefix — it is functionally a scheduler option.
const SCHEDULER_KEY_OVERRIDES = new Set(['scheduler', 'winner_per_loop']);
const WINNER_VERIFICATION_KEY_OVERRIDES = new Set(['winner_verification',]);

// Is this key part of the scheduler section?
function isSchedulerKey(key) {
  return SCHEDULER_KEY_OVERRIDES.has(key) || key.startsWith('scheduler_');
}

function isWinnerVerificationKey(key) {
  return (
    WINNER_VERIFICATION_KEY_OVERRIDES.has(key) ||
    key.startsWith('winner_verification_')
  );
}
// Nicer, human-facing labels for the known settings keys. Anything not listed
// here falls back to a generated title (underscores -> spaces).
const FIELD_LABELS = {
  auto_start_giveaway: 'Auto Start Giveaway',
  entry_cost: 'Entry Cost',
  giveaway_max_entries: 'Max Entries',
  hard_pity: 'Hard Pity',
  allow_session_duplicates: 'Allow Session Duplicates',
  allow_recent_winners: 'Allow Recent Winners',
  duplicate_check_count: 'Duplicate Check Count',
  min_follow_days: 'Min Follow Days',
  follow_expire_days: 'Follow Expire Days',
  giveaway_tier1_mult: 'Tier 1 Multiplier',
  giveaway_tier2_mult: 'Tier 2 Multiplier',
  giveaway_tier3_mult: 'Tier 3 Multiplier',
  giveaway_prime_mult: 'Prime Multiplier',
  giveaway_curve_exponent: 'Curve Exponent',
  giveaway_curve_scale: 'Curve Scale',
  giveaway_max_weight: 'Max Weight',

  // Scheduler section
  scheduler: 'Scheduler',
  scheduler_runtime: 'Runtime',
  scheduler_min_entries: 'Min Entries',
  scheduler_loop_count: 'Loop Count',
  scheduler_loop_cooldown: 'Loop Cooldown',
  winner_per_loop: 'Winners Per Loop',
  scheduler_auto_roll: 'Auto Roll',
  scheduler_extension_seconds: 'Extension Seconds',
  scheduler_lock_after_min_seconds: 'Lock After Min Seconds',

  winner_verification: 'Winner Verification',
  winner_verification_code_length: 'Code Length',
  winner_verification_timeout: 'Timeout',
};

// Short descriptions shown under each field. Mirrors the RemoteUI config page.
const FIELD_HINTS = {
  auto_start_giveaway: 'Enable or disable the auto start giveaway from IDLE (triggers when transitioning from Offline to Live)',
  entry_cost: 'Points required to buy a ticket',
  giveaway_max_entries: 'How many tickets one user can buy',
  hard_pity: 'Guaranteed win after this many entries',
  allow_session_duplicates: 'One user can win multiple times in the same session',
  allow_recent_winners: 'Let past winners enter again immediately',
  duplicate_check_count: 'Size of the recent winners cooldown list',
  min_follow_days: 'Minimum days since follow to enter giveaways',
  follow_expire_days: 'Days after rechecking follow status',
  giveaway_tier1_mult: 'Winning weight multiplier for T1 subs',
  giveaway_tier2_mult: 'Winning weight multiplier for T2 subs',
  giveaway_tier3_mult: 'Winning weight multiplier for T3 subs',
  giveaway_prime_mult: 'Winning weight multiplier for Prime subs',
  giveaway_curve_exponent: 'How aggressively the pity weight increases',
  giveaway_curve_scale: 'The maximum bonus weight from the pity curve',
  giveaway_max_weight: 'Hard safety cap for total winning weight',

  // Scheduler section
  scheduler: 'Automate winner rolls on a timer',
  scheduler_runtime: 'How long the scheduled giveaway runs (seconds)',
  scheduler_min_entries: 'Minimum entries required before a loop can roll',
  scheduler_loop_count: 'How many loops the scheduler performs',
  scheduler_loop_cooldown: 'Pause between scheduler loops (seconds)',
  winner_per_loop: 'How many winners to pick per scheduler loop',
  scheduler_auto_roll: 'Roll automatically instead of waiting for a trigger',
  scheduler_extension_seconds: 'Extra time added to the runtime when extended',
  scheduler_lock_after_min_seconds: 'Lock entries after this many seconds',

  // Winner Verification section
  winner_verification: 'Require winners to complete a verification step',
  winner_verification_code_length: 'Number of digits in the verification code (0 for no code)',
  winner_verification_timeout: 'How long the winner has to complete verification (seconds)',
};

function humanizeKey(key) {
  return key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

// Pick a field type from the raw JS value so the renderer needs no hard-coding.
function inferType(value) {
  if (typeof value === 'boolean') return 'toggle';
  if (typeof value === 'number') return 'number';
  return 'text';
}

// Flatten a state node (NestedState proxy, plain object, etc.) to a plain dict.
function toPlain(value) {
  if (!value || typeof value !== 'object') return value;
  if (typeof value.toObject === 'function') return value.toObject();
  if (typeof value.toJSON === 'function') return value.toJSON();
  return { ...value };
}

// Read the giveaway settings from the live window state. Prefers the nested
// `configuration` block when present, otherwise falls back to the flat object.
function getSettingsObject() {
  const gw = window.state?.giveaway;
  if (!gw) return null;

  const plain = toPlain(gw);
  if (plain && plain.config && typeof plain.config === 'object') {
    return toPlain(plain.config);
  }
  return plain;
}

// Build the general (non-scheduler) FIELDS list — one entry per scalar key.
function buildFields(settings) {
  const fields = [];

  for (const [key, value] of Object.entries(settings || {})) {
    // Skip nested objects/sections and scheduler keys — only scalar leaves
    // outside the scheduler section become editable general rows.
    if (value && typeof value === 'object') continue;
    if (isSchedulerKey(key)) continue;
    if (isWinnerVerificationKey(key)) continue;

    const type = inferType(value);
    fields.push({
      id: key,
      label: FIELD_LABELS[key] || humanizeKey(key),
      hint: FIELD_HINTS[key] || '',
      type,
      value,
    });
  }

  return fields;
}

// Build the scheduler section fields (master toggle + drawer sub-options).
function buildSchedulerFields(settings) {
  if (!settings || typeof settings !== 'object') {
    return [];
  }

  // `scheduler` is the master switch.
  // If the server does not provide it as a boolean, there is no scheduler
  // section to render.
  if (typeof settings.scheduler !== 'boolean') {
    return [];
  }

  const fields = [{
    id: 'scheduler',
    label: FIELD_LABELS.scheduler || 'Scheduler',
    hint: FIELD_HINTS.scheduler || '',
    type: 'toggle',
    value: settings.scheduler,
  }];

  // Everything else belonging to the scheduler becomes a child row.
  for (const [key, value] of Object.entries(settings)) {
    if (key === 'scheduler') continue;
    if (!isSchedulerKey(key)) continue;
    if (value && typeof value === 'object') continue;

    fields.push({
      id: key,
      label: FIELD_LABELS[key] || humanizeKey(key),
      hint: FIELD_HINTS[key] || '',
      type: inferType(value),
      value,
    });
  }

  return fields;
}

function buildWinnerVerificationFields(settings) {
  if (!settings || typeof settings !== 'object') {
    return [];
  }

  // winner_verification is the master switch.
  // If the server does not provide it as a boolean, don't render the section.
  if (typeof settings.winner_verification !== 'boolean') {
    return [];
  }

  const fields = [{
    id: 'winner_verification',
    label: FIELD_LABELS.winner_verification || 'Winner Verification',
    hint: FIELD_HINTS.winner_verification || '',
    type: 'toggle',
    value: settings.winner_verification,
  }];

  // Everything else belonging to winner verification becomes a child row.
  for (const [key, value] of Object.entries(settings)) {
    if (key === 'winner_verification') continue;
    if (!isWinnerVerificationKey(key)) continue;
    if (value && typeof value === 'object') continue;

    fields.push({
      id: key,
      label: FIELD_LABELS[key] || humanizeKey(key),
      hint: FIELD_HINTS[key] || '',
      type: inferType(value),
      value,
    });
  }

  return fields;
}

// Build one adaptive settings row (shared by general + scheduler sub-fields).
function createFieldRow(field) {
  const row = document.createElement('div');
  row.className = 'settings-row';

  const label = document.createElement('label');
  label.className = 'settings-row__label';
  label.textContent = field.label;
  label.setAttribute('for', `giveaway-field-${field.id}`);

  const control = document.createElement('div');
  control.className = 'settings-row__control';

  const input = document.createElement('input');
  input.id = `giveaway-field-${field.id}`;

  if (field.type === 'toggle') {
    input.type = 'checkbox';
    input.className = 'settings-toggle';
    input.checked = !!field.value;
  } else if (field.type === 'number') {
    input.type = 'number';
    input.className = 'settings-input settings-input--number';
    input.step = 'any';
    input.min = '0';
    input.value = field.value;
  } else {
    input.type = 'text';
    input.className = 'settings-input';
    input.value = field.value ?? '';
  }

  control.appendChild(input);
  row.appendChild(label);
  row.appendChild(control);

  if (field.hint) {
    const hint = document.createElement('p');
    hint.className = 'settings-row__hint';
    hint.textContent = field.hint;
    row.appendChild(hint);
  }

  return row;
}

// Render a collapsible settings section with a master switch.
// inside an animated drawer that only opens while the switch is on. The sub
// rows stay mounted (clipped, not removed) so their values persist for Save.
function renderCollapsibleSection(container, fields, sectionId, masterId) {
  const master = fields.find((field) => field.id === masterId);

  if (!master) return;

  const subFields = fields.filter((field) => field.id !== masterId);

  const section = document.createElement('div');
  section.className = 'settings-section';
  section.id = sectionId;

  // -------------------------------------------------------------------------
  // Header
  // -------------------------------------------------------------------------

  const header = document.createElement('div');
  header.className = 'settings-section__header';

  const title = document.createElement('div');
  title.className = 'settings-section__title';

  const titleLabel = document.createElement('label');
  titleLabel.className = 'settings-section__label';
  titleLabel.textContent = master.label;
  titleLabel.setAttribute(
    'for',
    `giveaway-field-${masterId}`
  );

  title.appendChild(titleLabel);

  if (master.hint) {
    const titleHint = document.createElement('p');
    titleHint.className = 'settings-section__hint';
    titleHint.textContent = master.hint;
    title.appendChild(titleHint);
  }

  const chevron = document.createElement('img');
  chevron.className = 'settings-section__chevron';
  chevron.src = '../../../assets/chevron.svg';
  chevron.alt = '';
  chevron.setAttribute('aria-hidden', 'true');

  title.appendChild(chevron);

  // -------------------------------------------------------------------------
  // Master toggle
  // -------------------------------------------------------------------------

  const masterControl = document.createElement('div');
  masterControl.className = 'settings-section__toggle';

  const toggle = document.createElement('input');
  toggle.type = 'checkbox';
  toggle.id = `giveaway-field-${masterId}`;
  toggle.className = 'settings-toggle';
  toggle.checked = !!master.value;

  toggle.setAttribute(
    'aria-controls',
    `${sectionId}-options`
  );

  masterControl.appendChild(toggle);

  header.appendChild(title);
  header.appendChild(masterControl);

  header.addEventListener('click', (event) => {
    if (event.target === toggle || event.target.closest('input')) {
      return;
    }
    toggle.checked = !toggle.checked;
    setOpen(toggle.checked);
  });

  // -------------------------------------------------------------------------
  // Drawer body
  // -------------------------------------------------------------------------

  const body = document.createElement('div');
  body.className = 'settings-section__body';
  body.id = `${sectionId}-options`;

  const inner = document.createElement('div');
  inner.className = 'settings-section__body-inner';

  for (const field of subFields) {
    inner.appendChild(createFieldRow(field));
  }

  body.appendChild(inner);

  // -------------------------------------------------------------------------
  // Open / close
  // -------------------------------------------------------------------------

  const setOpen = (open) => {
    section.classList.toggle('is-open', open);
    body.classList.toggle('is-open', open);

    toggle.setAttribute(
      'aria-expanded',
      open ? 'true' : 'false'
    );

    body.setAttribute(
      'aria-hidden',
      open ? 'false' : 'true'
    );
  };

  // IMPORTANT:
  // master=false => header only
  // master=true  => header + animated drawer
  setOpen(toggle.checked);

  toggle.addEventListener('change', () => {
    setOpen(toggle.checked);
  });

  section.appendChild(header);
  section.appendChild(body);

  container.appendChild(section);
}

// Render the modal body: Scheduler section first, then the general rows.
function renderFields(container) {
  if (!container) return;

  const settings = getSettingsObject();
  if (!settings) {
    container.textContent = 'Giveaway settings are not available yet.';
    return;
  }

  FIELDS.length = 0;
  SCHEDULER_FIELDS.length = 0;
  WINNER_VERIFICATION_FIELDS.length = 0;

  FIELDS.push(...buildFields(settings));
  SCHEDULER_FIELDS.push(...buildSchedulerFields(settings));
  WINNER_VERIFICATION_FIELDS.push(
    ...buildWinnerVerificationFields(settings)
  );
  container.textContent = '';

  // Scheduler section sits proudly at the top of the modal (when present).
  if (SCHEDULER_FIELDS.length > 0) {
    renderCollapsibleSection(
      container,
      SCHEDULER_FIELDS,
      'scheduler-section',
      'scheduler'
    );
  }

  if (WINNER_VERIFICATION_FIELDS.length > 0) {
    renderCollapsibleSection(
      container,
      WINNER_VERIFICATION_FIELDS,
      'winner-verification-section',
      'winner_verification'
    );
  }

  // General fields.
  for (const field of FIELDS) {
    container.appendChild(createFieldRow(field));
  }
}

// ---------------------------------------------------------------------------
// Value collection
// ---------------------------------------------------------------------------

// Read every rendered control (general + scheduler drawer sub-fields) into a
// flat giveaway config dict. Values are read from the live DOM so the drawer
// being open or closed does not matter.
function collectGiveawayConfig() {
  const values = {};

  for (const field of [
    ...FIELDS,
    ...SCHEDULER_FIELDS,
    ...WINNER_VERIFICATION_FIELDS,
  ]) {
    const input = document.getElementById(`giveaway-field-${field.id}`);
    if (!input) {
      values[field.id] = field.value;
      continue;
    }

    if (field.type === 'toggle') {
      values[field.id] = input.checked;
    } else if (field.type === 'number') {
      const n = Number(input.value);
      values[field.id] = Number.isNaN(n) ? field.value : n;
    } else {
      values[field.id] = input.value;
    }
  }

  return values;
}

// Rebuild the full configuration payload for `save_config`. The server's
// save_config command replaces the whole config file, so the giveaway section
// gets merged over the current snapshot. Prefers an explicit raw-config field
// when the server provides one, otherwise reconstructs from the live state.
function getFullConfigBase() {
  const remote = window.state?.remote_config;
  if (remote && typeof remote.toObject === 'function' && Object.keys(remote.toObject()).length) {
    return remote.toObject();
  }
  if (remote && typeof remote === 'object' && Object.keys(remote).length) {
    return { ...remote };
  }

  const base = {};
  for (const section of ['twitch', 'settings', 'loyalty', 'scanner', 'obs', 'giveaway']) {
    const value = window.state?.[section];
    if (value) base[section] = toPlain(value);
  }
  return base;
}

// Track the original config for detecting changes on save.
let originalGiveawayConfig = {};

// Last nodes that received listeners (for safe re-wiring on force reloads).
let boundGear = null;
let boundModal = null;
let boundClose = null;
let boundSave = null;
let documentBound = false;

// ---------------------------------------------------------------------------
// Element helpers
// ---------------------------------------------------------------------------

function getModal() {
  return document.getElementById('giveaway-settings-modal');
}

function getGear() {
  return document.getElementById('giveaway-settings-toggle');
}

function getCloseButton() {
  return document.getElementById('giveaway-settings-close');
}

function getSaveButton() {
  return document.getElementById('giveaway-settings-save');
}

// ---------------------------------------------------------------------------
// Open / close
// ---------------------------------------------------------------------------

function openModal() {
  const modal = getModal();
  if (!modal) return;

  const fieldsContainer = modal.querySelector('#giveaway-settings-fields');

  if (fieldsContainer) {
    renderFields(fieldsContainer);
    originalGiveawayConfig = collectGiveawayConfig();
  }

  modal.classList.remove('hidden');
}

function closeModal() {
  const modal = getModal();
  if (!modal) return;
  modal.classList.add('hidden');
}

// ---------------------------------------------------------------------------
// Event handlers
// ---------------------------------------------------------------------------

function handleGearClick(event) {
  event.preventDefault();
  openModal();
}

function handleBackdropClick(event) {
  // Clicks on the dark backdrop (not the card) dismiss the modal.
  if (event.target === getModal()) {
    closeModal();
  }
}

function handleDocumentKeydown(event) {
  if (event.key === 'Escape') {
    closeModal();
  }
}

function handlePageActivate() {
  // Navigating away from the page leaves the modal behind.
  closeModal();
}

// Minimal toast that reuses the giveaway page's toast element when present,
// otherwise builds one. Keeps the settings module self-contained so the modal
// can report save results without depending on the page controller.
let settingsToastTimer = null;
async function showSettingsToast(message, tone = 'info') {
  let toast = document.getElementById('giveaway-toast');

  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'giveaway-toast';
    document.body.appendChild(toast);
  } else if (toast.classList.contains('is-visible')) {
    toast.classList.remove('is-visible');
    await new Promise((resolve) => setTimeout(resolve, 160));
  }

  toast.className = `giveaway-toast giveaway-toast--${tone}`;
  toast.classList.remove('is-visible');

  const toneMap = {
    info: { icon: 'ℹ', title: 'Information' },
    success: { icon: '✓', title: 'Success' },
    warning: { icon: '⚠', title: 'Warning' },
    error: { icon: '✕', title: 'Error' },
  };
  const current = toneMap[tone] || toneMap.info;

  toast.innerHTML = `
    <div class="giveaway-toast__content">
      <div class="giveaway-toast__icon">${current.icon}</div>
      <div class="giveaway-toast__body">
        <h4 class="giveaway-toast__title">${current.title}</h4>
        <p class="giveaway-toast__message">${message}</p>
      </div>
    </div>
    <div class="giveaway-toast__progress"></div>
  `;

  requestAnimationFrame(() => toast.classList.add('is-visible'));

  clearTimeout(settingsToastTimer);
  settingsToastTimer = setTimeout(() => toast.classList.remove('is-visible'), 2600);
}

async function handleSave() {
  const current = collectGiveawayConfig();
  const changed = {};

  for (const [key, value] of Object.entries(current)) {
    if (value !== originalGiveawayConfig[key]) {
      changed[key] = value;
    }
  }

  // Nothing changed — no request needed.
  if (Object.keys(changed).length === 0) {
    showSettingsToast('No changes to save.', 'info');
    closeModal();
    return;
  }

  const connection = window.connection;
  const bridge = connection?.getBridge?.();

  if (!bridge || !connection.isConnected()) {
    showSettingsToast('Not connected to server.', 'warning');
    return;
  }

  try {
    const response = await bridge.sendWithResponse('save_config', {
      data: {
        giveaway: changed,
      },
    });

    if (response?.ok) {
      originalGiveawayConfig = current;
      showSettingsToast('Giveaway settings saved.', 'success');
      closeModal();
    } else {
      showSettingsToast(
        response?.error || 'Failed to save settings.',
        'error'
      );
    }
  } catch (error) {
    console.error('[Giveaway] Settings save error:', error);
    showSettingsToast('Failed to save settings.', 'error');
  }
}

// ---------------------------------------------------------------------------
// Init — safe to call repeatedly (page script re-evaluates on force reload)
// ---------------------------------------------------------------------------

function init() {
  const gear = getGear();
  const modal = getModal();

  if (!gear || !modal) {
    console.warn('[Giveaway] Settings toggle or modal not found.');
    return;
  }

  // Gear button — bind the current node, unbinding the previous one if the
  // DOM was rebuilt (the old node is usually gone; removing is harmless).
  if (boundGear && boundGear !== gear) {
    boundGear.removeEventListener('click', handleGearClick);
  }
  gear.addEventListener('click', handleGearClick);
  boundGear = gear;

  // Modal overlay backdrop — same node-safe rebinding.
  if (boundModal && boundModal !== modal) {
    boundModal.removeEventListener('click', handleBackdropClick);
  }
  modal.addEventListener('click', handleBackdropClick);
  boundModal = modal;

  // Document-level listeners only ever need wiring once — the document
  // itself is not replaced by page reloads.
  if (!documentBound) {
    document.addEventListener('keydown', handleDocumentKeydown);
    document.addEventListener('page:activate', handlePageActivate);
    documentBound = true;
  }

  // Footer buttons — node-safe rebinding.
  const closeButton = getCloseButton();
  if (boundClose && boundClose !== closeButton) {
    boundClose.removeEventListener('click', closeModal);
  }
  closeButton?.addEventListener('click', closeModal);
  boundClose = closeButton;

  const saveButton = getSaveButton();
  if (boundSave && boundSave !== saveButton) {
    boundSave.removeEventListener('click', handleSave);
  }
  saveButton?.addEventListener('click', handleSave);
  boundSave = saveButton;
}

export {
  FIELDS,
  SCHEDULER_FIELDS,
  WINNER_VERIFICATION_FIELDS,
  buildFields,
  buildSchedulerFields,
  buildWinnerVerificationFields,
  collectGiveawayConfig,
  renderFields,
  init,
  openModal,
  closeModal,
};