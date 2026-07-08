async function init() {
  // Populate version
  const version = await window.tracker.getVersion();
  document.getElementById('app-version').textContent = `v${version}`;

  // Populate beta preference
  const betaEnabled = await window.tracker.getBetaPref();
  document.getElementById('beta-checkbox').checked = betaEnabled;

  // GitHub link
  document.getElementById('github-link').addEventListener('click', () => {
    window.tracker.openExternal('https://github.com/dhoepp/ShiftTracker');
  });

  // Beta toggle
  document.getElementById('beta-checkbox').addEventListener('change', async (e) => {
    await window.tracker.setBetaPref(e.target.checked);
  });
}

init();
