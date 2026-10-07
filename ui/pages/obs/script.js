window.pageControllers = window.pageControllers || {};
window.pageControllers.obs = function () {
  document.getElementById('obs-refresh')?.addEventListener('click', () => {
    console.log('OBS placeholder: refresh action');
  });
};
