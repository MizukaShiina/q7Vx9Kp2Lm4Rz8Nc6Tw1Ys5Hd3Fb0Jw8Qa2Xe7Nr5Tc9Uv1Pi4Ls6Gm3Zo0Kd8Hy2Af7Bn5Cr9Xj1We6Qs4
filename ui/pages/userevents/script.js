window.pageControllers = window.pageControllers || {};

window.pageControllers.userevents = function () {
  const root = document.getElementById('user-events-page');
  if (!root) return;

  const POLL_TEMPLATE_KEY = 'mizubot:user-events:poll-templates:v1';
  const byId = (id) => document.getElementById(id);
  let toastTimer = null;
  let pendingAction = false;
  let pollTemplates = [];
  const builtInPollTemplates = normalizePollTemplates(
    window.MizuBotUserEventTemplates?.polls
  );

  const node = (tag, className, text) => {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined && text !== null) element.textContent = String(text);
    return element;
  };

  function escapeError(error) {
    if (typeof error === 'string') return error;
    return error?.message || 'The request could not be completed.';
  }

  function showToast(message, tone = 'success') {
    const toast = byId('user-events-toast');
    if (!toast) return;
    toast.textContent = message;
    toast.dataset.tone = tone;
    toast.classList.add('is-visible');
    clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => toast.classList.remove('is-visible'), 3200);
  }

  function setConnectionStatus() {
    const connection = window.connection?.getConnectionState?.();
    const connected = connection?.connected === true && connection?.authenticated !== false;
    const pill = byId('user-events-connection');
    if (!pill) return;
    pill.dataset.state = connected ? 'connected' : 'offline';
    byId('user-events-connection-label').textContent = connected
      ? 'Bot connected'
      : (connection?.label || 'Waiting for bot');
  }

  function getChoices(kind) {
    const container = byId(`${kind}-choice-list`);
    return [...(container?.querySelectorAll('input') || [])].map((input) => input.value.trim());
  }

  function addChoice(kind, value = '') {
    const container = byId(`${kind}-choice-list`);
    if (!container) return;
    const max = kind === 'poll' ? 5 : 10;
    if (container.children.length >= max) return;

    const row = node('div', 'event-choice-row');
    const index = node('span', 'event-choice-row__index', String(container.children.length + 1).padStart(2, '0'));
    index.setAttribute('aria-hidden', 'true');
    const input = node('input', '');
    input.type = 'text';
    input.maxLength = 25;
    input.required = true;
    input.autocomplete = 'off';
    input.placeholder = kind === 'poll' ? `Choice ${container.children.length + 1}` : `Outcome ${container.children.length + 1}`;
    input.value = value;
    input.setAttribute('aria-label', `${kind === 'poll' ? 'Poll choice' : 'Prediction outcome'} ${container.children.length + 1}`);
    const remove = node('button', 'event-choice-remove', '×');
    remove.type = 'button';
    remove.dataset.removeChoice = kind;
    remove.setAttribute('aria-label', `Remove ${kind === 'poll' ? 'choice' : 'outcome'}`);
    row.append(index, input, remove);
    container.appendChild(row);
    updateChoiceRows(kind);
  }

  function updateChoiceRows(kind) {
    const container = byId(`${kind}-choice-list`);
    if (!container) return;
    const rows = [...container.children];
    const min = 2;
    const max = kind === 'poll' ? 5 : 10;
    rows.forEach((row, index) => {
      row.querySelector('.event-choice-row__index').textContent = String(index + 1).padStart(2, '0');
      const input = row.querySelector('input');
      input.placeholder = `${kind === 'poll' ? 'Choice' : 'Outcome'} ${index + 1}`;
      input.setAttribute('aria-label', `${kind === 'poll' ? 'Poll choice' : 'Prediction outcome'} ${index + 1}`);
      row.querySelector('.event-choice-remove').disabled = rows.length <= min;
    });
    const addButton = root.querySelector(`[data-add-choice="${kind}"]`);
    if (addButton) addButton.disabled = rows.length >= max;
  }

  function setBusy(busy) {
    pendingAction = busy;
    root.querySelectorAll('button[type="submit"]').forEach((button) => {
      button.disabled = busy;
      if (busy) button.dataset.busy = 'true';
      else delete button.dataset.busy;
    });
    root.querySelectorAll('[data-event-action]').forEach((button) => {
      button.disabled = busy;
    });
  }

  async function sendAction(action, payload, successMessage) {
    if (pendingAction) return null;
    const bridge = window.connection?.getBridge?.();
    if (!bridge?.connected || !bridge?.authenticated) {
      showToast('Connect to the bot before managing polls or predictions.', 'error');
      return null;
    }

    setBusy(true);
    try {
      const response = await bridge.sendWithResponse(action, payload);
      if (!response?.ok) {
        showToast(escapeError(response?.error), 'error');
        return null;
      }
      if (response.result === null || response.result === false) {
        showToast('Twitch did not accept that action. Check the current event status and bot logs.', 'error');
        return null;
      }
      if (successMessage) showToast(successMessage);
      return response.result;
    } catch (error) {
      showToast(escapeError(error), 'error');
      return null;
    } finally {
      setBusy(false);
    }
  }

  function formatDate(value) {
    if (!value) return 'Time unavailable';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
  }

  function setEventStatus(kind, active) {
    const status = byId(`${kind}-status`);
    const indicator = byId(`${kind}-live-indicator`);
    if (!status || !indicator) return;
    const eventStatus = String(active?.status || '').toUpperCase();
    status.textContent = eventStatus || 'Ready';
    status.dataset.state = eventStatus === 'ACTIVE' ? 'active' : eventStatus === 'LOCKED' ? 'locked' : 'ready';
    indicator.dataset.live = String(Boolean(active));
    indicator.replaceChildren(node('i'), document.createTextNode(
      !active ? ` No active ${kind}` : eventStatus === 'LOCKED' ? ' Locked' : ' Live now'
    ));
  }

  function addMeta(parent, label, value) {
    if (value === null || value === undefined || value === '') return;
    parent.appendChild(node('span', '', `${label} ${value}`));
  }

  function addResultBar(parent, label, count, total, winner = false, countLabel = null) {
    const result = node('div', 'event-result');
    const labels = node('div', 'event-result__labels');
    labels.append(node('span', '', label), node('strong', '', countLabel ?? Number(count || 0).toLocaleString()));
    const bar = node('div', 'event-result__bar');
    const fill = node('div', `event-result__fill${winner ? ' is-winner' : ''}`);
    const percentage = Number(total) > 0 ? Math.max(0, Math.min(100, Number(count || 0) / Number(total) * 100)) : 0;
    fill.style.width = `${percentage}%`;
    bar.appendChild(fill);
    result.append(labels, bar);
    parent.appendChild(result);
  }

  function renderPollActive(active, populated) {
    const container = byId('poll-active-content');
    container.replaceChildren();
    setEventStatus('poll', active);
    if (!active) {
      container.appendChild(node('p', 'event-empty', populated
        ? 'No active poll. Build a question above or start from one of your saved templates.'
        : 'Connect to the bot to check for an active poll.'));
      return;
    }

    const card = node('div', 'event-card');
    const header = node('div', 'event-card__title-row');
    header.appendChild(node('h6', 'event-card__title', active.title || 'Untitled poll'));
    const badge = node('span', 'event-state-badge', active.status || 'ACTIVE');
    badge.dataset.status = active.status || 'ACTIVE';
    header.appendChild(badge);
    const meta = node('div', 'event-card__meta');
    addMeta(meta, 'Started', formatDate(active.started_at));
    addMeta(meta, 'Ends', formatDate(active.ends_at));
    const results = node('div', 'event-results');
    const choices = Array.isArray(active.choices) ? active.choices : [];
    const totalVotes = choices.reduce((sum, choice) => sum + Number(choice.votes || 0), 0);
    choices.forEach((choice) => addResultBar(results, choice.title || 'Choice', choice.votes, totalVotes));
    const actions = node('div', 'event-action-row');
    const end = node('button', 'event-button event-button--danger event-button--small', 'End poll');
    end.type = 'button';
    end.dataset.eventAction = 'end-poll';
    end.dataset.eventId = active.id || '';
    end.addEventListener('click', async () => {
      if (!window.confirm('End the active poll now?')) return;
      await sendAction('end_poll', { poll_id: active.id }, 'Poll ended.');
    });
    actions.appendChild(end);
    card.append(header, meta, results, actions);
    container.appendChild(card);
  }

  function renderPredictionActive(active, populated) {
    const container = byId('prediction-active-content');
    container.replaceChildren();
    setEventStatus('prediction', active);
    if (!active) {
      container.appendChild(node('p', 'event-empty', populated
        ? 'No active prediction. Set your title and outcomes above to get chat calling it.'
        : 'Connect to the bot to check for an active prediction.'));
      return;
    }

    const card = node('div', 'event-card');
    const header = node('div', 'event-card__title-row');
    header.appendChild(node('h6', 'event-card__title', active.title || 'Untitled prediction'));
    const badge = node('span', 'event-state-badge', active.status || 'ACTIVE');
    badge.dataset.status = active.status || 'ACTIVE';
    header.appendChild(badge);
    const meta = node('div', 'event-card__meta');
    addMeta(meta, 'Started', formatDate(active.started_at));
    addMeta(meta, active.status === 'LOCKED' ? 'Locked' : 'Locks', formatDate(active.locked_at || active.locks_at));
    const results = node('div', 'event-results');
    const outcomes = Array.isArray(active.outcomes) ? active.outcomes : [];
    const totalPoints = outcomes.reduce((sum, outcome) => sum + Number(outcome.channel_points || 0), 0);
    outcomes.forEach((outcome) => addResultBar(
      results,
      outcome.title || 'Outcome',
      Number(outcome.channel_points || 0),
      totalPoints,
      String(outcome.id) === String(active.winning_outcome_id),
        `${Number(outcome.users || 0).toLocaleString()} · ${Number(outcome.channel_points || 0).toLocaleString()} pts`
    ));

    const actions = node('div', 'event-action-row');
    if (active.status === 'ACTIVE') {
      const lock = node('button', 'event-button event-button--primary event-button--small', 'Lock prediction');
      lock.type = 'button';
      lock.dataset.eventAction = 'lock-prediction';
      lock.addEventListener('click', async () => {
        await sendAction('lock_prediction', { prediction_id: active.id }, 'Prediction locked.');
      });
      actions.appendChild(lock);
    }
    if (active.status === 'LOCKED' && outcomes.length) {
      const select = node('select', 'event-resolve-select');
      select.setAttribute('aria-label', 'Winning prediction outcome');
      select.appendChild(new Option('Choose the winning outcome…', ''));
      outcomes.forEach((outcome) => select.appendChild(new Option(outcome.title || 'Outcome', outcome.id)));
      const resolve = node('button', 'event-button event-button--primary event-button--small', 'Resolve');
      resolve.type = 'button';
      resolve.disabled = true;
      select.addEventListener('change', () => { resolve.disabled = !select.value || pendingAction; });
      resolve.addEventListener('click', async () => {
        if (!select.value || !window.confirm(`Resolve this prediction as “${select.selectedOptions[0]?.textContent}”?`)) return;
        await sendAction('resolve_prediction', {
          prediction_id: active.id,
          winning_outcome_id: select.value,
        }, 'Prediction resolved.');
      });
      actions.append(select, resolve);
    }
    const cancel = node('button', 'event-button event-button--danger event-button--small', 'Cancel');
    cancel.type = 'button';
    cancel.dataset.eventAction = 'cancel-prediction';
    cancel.addEventListener('click', async () => {
      if (!window.confirm('Cancel this prediction? Twitch will refund points to participants.')) return;
      await sendAction('cancel_prediction', { prediction_id: active.id }, 'Prediction canceled.');
    });
    actions.appendChild(cancel);
    card.append(header, meta, results, actions);
    container.appendChild(card);
  }

  function renderRecentPolls(items, populated) {
    const container = byId('poll-recent-list');
    const recent = Array.isArray(items) ? items.slice(0, 5) : [];
    byId('poll-recent-count').textContent = `${recent.length} / 5`;
    container.replaceChildren();
    if (!recent.length) {
      container.appendChild(node('p', 'event-empty', populated ? 'No recent poll results yet.' : 'Recent results appear when the bot connects.'));
      return;
    }
    recent.forEach((poll) => {
      const item = node('article', 'event-recent-item');
      const header = node('div', 'event-card__title-row');
      header.appendChild(node('h6', 'event-card__title', poll.title || 'Untitled poll'));
      const badge = node('span', 'event-state-badge', poll.status || 'ENDED');
      badge.dataset.status = poll.status || 'COMPLETED';
      header.appendChild(badge);
      const details = (Array.isArray(poll.choices) ? poll.choices : [])
        .map((choice) => `${choice.title || 'Choice'} · ${Number(choice.votes || 0).toLocaleString()} votes`)
        .join('  /  ');
      item.append(header, node('div', 'event-recent-item__detail', details || 'No vote totals available'));
      const time = poll.ended_at || poll.started_at;
      if (time) item.appendChild(node('div', 'event-card__meta', formatDate(time)));
      container.appendChild(item);
    });
  }

  function renderRecentPredictions(items, populated) {
    const container = byId('prediction-recent-list');
    const recent = Array.isArray(items) ? items.slice(0, 5) : [];
    byId('prediction-recent-count').textContent = `${recent.length} / 5`;
    container.replaceChildren();
    if (!recent.length) {
      container.appendChild(node('p', 'event-empty', populated ? 'No recent prediction results yet.' : 'Recent results appear when the bot connects.'));
      return;
    }
    recent.forEach((prediction) => {
      const item = node('article', 'event-recent-item');
      const header = node('div', 'event-card__title-row');
      header.appendChild(node('h6', 'event-card__title', prediction.title || 'Untitled prediction'));
      const badge = node('span', 'event-state-badge', prediction.status || 'ENDED');
      badge.dataset.status = prediction.status || 'RESOLVED';
      header.appendChild(badge);
      const winner = (prediction.outcomes || []).find(
        (outcome) => String(outcome.id) === String(prediction.winning_outcome_id)
      );
      if (winner) {
        item.appendChild(node('div', 'event-recent-item__detail is-winner', `Winner · ${winner.title}`));
      } else if (prediction.status === 'CANCELED') {
        item.appendChild(node('div', 'event-recent-item__detail', 'Canceled · channel points refunded'));
      }
      const details = (Array.isArray(prediction.outcomes) ? prediction.outcomes : [])
        .map((outcome) => `${outcome.title || 'Outcome'} · ${Number(outcome.channel_points || 0).toLocaleString()} pts`)
        .join('  /  ');
      item.append(header, node('div', 'event-recent-item__detail', details || 'No point totals available'));
      const time = prediction.ended_at || prediction.started_at;
      if (time) item.appendChild(node('div', 'event-card__meta', formatDate(time)));
      container.appendChild(item);
    });
  }

  function render(state = window.state) {
    setConnectionStatus();
    const populated = Boolean(state?.populated);
    const events = state?.twitch_events;
    renderPollActive(events?.polls?.active || null, populated);
    renderPredictionActive(events?.predictions?.active || null, populated);
    renderRecentPolls(events?.polls?.recent || [], populated);
    renderRecentPredictions(events?.predictions?.recent || [], populated);
  }

  function normalizePollTemplates(templates) {
    if (!Array.isArray(templates)) return [];
    return templates.filter((template) => (
      template && typeof template.name === 'string' &&
      typeof template.question === 'string' &&
      Array.isArray(template.options)
    )).slice(0, 30);
  }

  async function loadPollTemplates() {
    try {
      if (typeof window.electronAPI?.loadPollTemplates === 'function') {
        pollTemplates = normalizePollTemplates(await window.electronAPI.loadPollTemplates());
      } else {
        const parsed = JSON.parse(window.localStorage.getItem(POLL_TEMPLATE_KEY) || '[]');
        pollTemplates = normalizePollTemplates(parsed);
      }
      renderPollTemplates();
    } catch (error) {
      console.error('[User Events] Could not load poll templates:', error);
      showToast('Could not load saved poll templates.', 'error');
    }
  }

  async function persistPollTemplates(templates) {
    if (typeof window.electronAPI?.savePollTemplates === 'function') {
      await window.electronAPI.savePollTemplates(templates);
      return;
    }
    window.localStorage.setItem(POLL_TEMPLATE_KEY, JSON.stringify(templates));
  }

  function renderPollTemplates() {
    const select = byId('poll-template-select');
    if (!select) return;
    const selected = select.value;
    select.replaceChildren(new Option('Choose a template…', ''));

    if (builtInPollTemplates.length) {
      const builtInGroup = document.createElement('optgroup');
      builtInGroup.label = 'Built-in templates';
      builtInPollTemplates.forEach((template) => {
        builtInGroup.appendChild(new Option(template.name, `builtin:${template.id}`));
      });
      select.appendChild(builtInGroup);
    }

    if (pollTemplates.length) {
      const savedGroup = document.createElement('optgroup');
      savedGroup.label = 'My templates';
      pollTemplates.forEach((template, index) => {
        savedGroup.appendChild(new Option(template.name, `saved:${index}`));
      });
      select.appendChild(savedGroup);
    }

    if ([...select.options].some((option) => option.value === selected)) select.value = selected;
    updateDeleteTemplateButton();
  }

  function updateDeleteTemplateButton() {
    const select = byId('poll-template-select');
    const button = byId('poll-delete-template');
    if (!select || !button) return;
    const isSavedTemplate = select.value.startsWith('saved:');
    button.classList.toggle('hidden', !isSavedTemplate);
    button.disabled = !isSavedTemplate;
  }

  function loadPollTemplate() {
    const [source, key] = byId('poll-template-select').value.split(':', 2);
    const template = source === 'builtin'
      ? builtInPollTemplates.find((entry) => entry.id === key)
      : source === 'saved'
        ? pollTemplates[Number(key)]
        : null;
    if (!template) return;
    byId('poll-question').value = template.question || '';
    byId('poll-duration').value = String(template.duration || 60);
    const container = byId('poll-choice-list');
    container.replaceChildren();
    (Array.isArray(template.options) ? template.options : []).forEach((option) => addChoice('poll', option));
    while (container.children.length < 2) addChoice('poll');
    showToast(`Loaded “${template.name}”.`);
  }

  async function savePollTemplate() {
    const question = byId('poll-question').value.trim();
    const options = getChoices('poll');
    if (!question || options.length < 2 || options.some((choice) => !choice)) {
      showToast('Enter a question and at least two choices before saving a template.', 'error');
      return;
    }
    const name = window.prompt('Name this poll template:');
    if (!name || !name.trim()) return;
    const templates = [{
      name: name.trim().slice(0, 40),
      question: question.slice(0, 60),
      options: options.slice(0, 5).map((choice) => choice.slice(0, 25)),
      duration: Number(byId('poll-duration').value) || 60,
    }, ...pollTemplates].slice(0, 30);
    try {
      await persistPollTemplates(templates);
      pollTemplates = templates;
      byId('poll-template-select').value = 'saved:0';
      renderPollTemplates();
      showToast('Poll template saved on this device.');
    } catch (error) {
      console.error('[User Events] Could not save poll template:', error);
      showToast('Could not save the poll template to this device.', 'error');
    }
  }

  async function deleteSelectedPollTemplate() {
    const select = byId('poll-template-select');
    const value = select?.value || '';
    if (!value.startsWith('saved:')) return;

    const index = Number(value.slice('saved:'.length));
    const template = pollTemplates[index];
    if (!template) return;
    if (!window.confirm(`Delete the saved template “${template.name}”?`)) return;

    const templates = pollTemplates.filter((_entry, entryIndex) => entryIndex !== index);
    try {
      await persistPollTemplates(templates);
      pollTemplates = templates;
      select.value = '';
      renderPollTemplates();
      showToast(`Deleted “${template.name}”.`);
    } catch (error) {
      console.error('[User Events] Could not delete poll template:', error);
      showToast('Could not delete the poll template from this device.', 'error');
    }
  }

  async function createPoll(event) {
    event.preventDefault();
    const question = byId('poll-question').value.trim();
    const options = getChoices('poll');
    const duration = Number(byId('poll-duration').value);
    if (options.length < 2 || options.length > 5 || options.some((choice) => !choice || choice.length > 25)) {
      showToast('A poll needs 2–5 non-empty choices of 25 characters or fewer.', 'error');
      return;
    }
    if (!Number.isInteger(duration) || duration < 15 || duration > 1800) {
      showToast('Poll duration must be between 15 and 1800 seconds.', 'error');
      return;
    }
    const result = await sendAction('create_poll', { question, options, duration }, 'Poll started.');
    if (result) {
      byId('poll-question').value = '';
      byId('poll-choice-list').replaceChildren();
      addChoice('poll');
      addChoice('poll');
    }
  }

  async function createPrediction(event) {
    event.preventDefault();
    const title = byId('prediction-title').value.trim();
    const outcomes = getChoices('prediction');
    const duration = Number(byId('prediction-duration').value);
    if (outcomes.length < 2 || outcomes.length > 10 || outcomes.some((outcome) => !outcome || outcome.length > 25)) {
      showToast('A prediction needs 2–10 non-empty outcomes of 25 characters or fewer.', 'error');
      return;
    }
    if (!Number.isInteger(duration) || duration < 30 || duration > 1800) {
      showToast('Prediction window must be between 30 and 1800 seconds.', 'error');
      return;
    }
    const result = await sendAction('create_prediction', { title, outcomes, duration }, 'Prediction started.');
    if (result) {
      byId('prediction-title').value = '';
      byId('prediction-choice-list').replaceChildren();
      addChoice('prediction');
      addChoice('prediction');
    }
  }

  root.addEventListener('click', async (event) => {
    const add = event.target.closest('[data-add-choice]');
    if (add) {
      addChoice(add.dataset.addChoice);
      return;
    }
    const remove = event.target.closest('[data-remove-choice]');
    if (remove) {
      remove.closest('.event-choice-row')?.remove();
      updateChoiceRows(remove.dataset.removeChoice);
    }
  });

  byId('poll-form')?.addEventListener('submit', createPoll);
  byId('prediction-form')?.addEventListener('submit', createPrediction);
  byId('poll-template-select')?.addEventListener('change', () => {
    loadPollTemplate();
    updateDeleteTemplateButton();
  });
  byId('poll-save-template')?.addEventListener('click', savePollTemplate);
  byId('poll-delete-template')?.addEventListener('click', deleteSelectedPollTemplate);
  byId('poll-choice-list')?.replaceChildren();
  byId('prediction-choice-list')?.replaceChildren();
  addChoice('poll');
  addChoice('poll');
  addChoice('prediction');
  addChoice('prediction');
  loadPollTemplates();
  updateDeleteTemplateButton();

  if (typeof window.pageControllers.__userEventsUnsubscribe === 'function') {
    window.pageControllers.__userEventsUnsubscribe();
  }
  window.pageControllers.__userEventsUnsubscribe = window.state?.subscribe?.(render) || (() => {});

  if (typeof window.pageControllers.__userEventsConnectionUnsubscribe === 'function') {
    window.pageControllers.__userEventsConnectionUnsubscribe();
  }
  window.pageControllers.__userEventsConnectionUnsubscribe = window.connection?.subscribeToConnectionState?.(setConnectionStatus) || (() => {});

  render();
};

window.pageControllers.userevents();
