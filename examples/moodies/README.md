# Moodies example

As-Built was first built for Moodies, a small mood check-in web app: a static folder of web files
whose backend SDK is loaded from a CDN. This folder shows how such a project is set up. It's a
sanitised example: the canvas link, selectors and data are placeholders, with no real IDs, emails or keys.

Copy `.claude/as-built/` into your project and adapt it:

- `config.json`: the app is the static folder `public/`, served by As-Built's built-in server.
  `routes` swaps the CDN SDK for `stub.js` and the app's `config.js` for `fake-config.js`.
- Screens build on each other with `"continue": true`: Mood is reached from Who, Picker is opened
  from Me. History starts a fresh signed-in page instead.
- `boardPrefix` is `Live-`, the board names Moodies used before As-Built became a plugin.
- `stub.js` answers every call the app makes, with fake sign-in (`window.__signedIn`, set by each
  screen's `init`) and fixed sample data.
