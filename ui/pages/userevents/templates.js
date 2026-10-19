/* Built-in Twitch poll templates. Add or edit defaults in this list. */
(function (global) {
  'use strict';

  const polls = [
    {
      id: 'quick-chat-vote',
      name: 'Quick chat vote',
      question: 'What should we do next?',
      options: ['Keep going', 'Switch it up', 'Take a break'],
      duration: 60,
    },
    {
      id: 'one-more-round',
      name: 'One more round?',
      question: 'Should we do one more round?',
      options: ['Yes, one more', 'No, wrap up'],
      duration: 45,
    },
  ].map((template) => Object.freeze({
    ...template,
    options: Object.freeze([...template.options]),
  }));

  global.MizuBotUserEventTemplates = Object.freeze({
    polls: Object.freeze(polls),
  });
})(window);
