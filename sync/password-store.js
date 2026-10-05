'use strict';

// Electron selects basic_text on unrecognized Linux desktops, even with an
// unlocked Secret Service. Select libsecret before app.ready in those sessions.
// Preserve KDE's native wallet selection and any explicit user override.
function configurePasswordStore(app, platform = process.platform, env = process.env) {
  if (platform !== 'linux' || app.commandLine.hasSwitch('password-store')) return;
  const desktop = (env.XDG_CURRENT_DESKTOP || '').split(':').map(value => value.trim().toLowerCase());
  const session = (env.DESKTOP_SESSION || '').toLowerCase();
  const kde = desktop.includes('kde') || /^(kde|plasma)/.test(session) ||
    !!env.KDE_SESSION_VERSION || Object.hasOwn(env, 'KDE_FULL_SESSION');
  const recognized = ['unity', 'deepin', 'gnome', 'x-cinnamon', 'pantheon', 'xfce', 'ukui', 'lxqt', 'cosmic'];
  if (kde || desktop.some(value => recognized.includes(value)) || env.GNOME_DESKTOP_SESSION_ID ||
    ['deepin', 'gnome', 'mate', 'xubuntu', 'ukui'].includes(session) || session.includes('xfce')) return;
  app.commandLine.appendSwitch('password-store', 'gnome-libsecret');
}

module.exports = { configurePasswordStore };
