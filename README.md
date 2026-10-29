<div align="center">
  <img src="images/banner.png" alt="ChungusHub: a self-hosted workspace for long-form roleplay">

<p><br></p>

ChungusHub is a local-first, privacy-focused LLM frontend for roleplay. Character cards and lorebooks use compatible file formats for individual import and export.

This fork keeps alternative replies as swipes and lets you branch a conversation into an independent chat. Regenerate replaces the selected replies only after the new response succeeds.

## Download

**[Android test APKs and releases](https://github.com/Tantoofaaz777/ChungusHub/releases)**

Run the server from this repository on Windows, macOS or Linux using the source instructions below. Portable desktop builds can also be produced locally with `bun run package`.

The **[documentation](docs/)** covers installing it, the first run and importing individual files. This is a fork of [the original ChungusHub](https://github.com/patcireamo/ChungusHub).

ChungusHub is under active development. So there might be some rough edges. Please do not hold back on bug reports, feature requests or plain feedback.

</div>

<h2 align="center">Showcase</h2>

<h3 align="center">Desktop</h3>

<table>
  <tr>
    <td align="center">
      <a href="images/screenshots/desktop_chat_bubbles.png"><img src="images/screenshots/desktop_chat_bubbles.png" alt="A chat in the Bubbles style, portraits beside each turn" width="400"></a><br>
      <sub>Bubbles</sub>
    </td>
    <td align="center">
      <a href="images/screenshots/desktop_chat_portraits.png"><img src="images/screenshots/desktop_chat_portraits.png" alt="The same chat in the Portraits style, one column with larger art" width="400"></a><br>
      <sub>Portraits</sub>
    </td>
  </tr>
  <tr>
    <td align="center">
      <a href="images/screenshots/desktop_lorebook.png"><img src="images/screenshots/desktop_lorebook.png" alt="A lorebook entry open, showing its keywords, filter and content" width="400"></a><br>
      <sub>Lorebook</sub>
    </td>
    <td align="center">
      <a href="images/screenshots/desktop_settings_and_library.png"><img src="images/screenshots/desktop_settings_and_library.png" alt="Settings docked on the left and the library on the right, either side of the workspace" width="400"></a><br>
      <sub>Settings and library on the sides</sub>
    </td>
  </tr>
</table>

<div align="center">
  <sub>Click a shot to open it full size.</sub>
</div>

<h3 align="center">Mobile</h3>

<div align="center">
  <img src="images/screenshots/mobile_welcome.png" alt="The welcome landing on a phone" width="250">
  <img src="images/screenshots/mobile_library.png" alt="The character library on a phone" width="250">
  <img src="images/screenshots/mobile_chat.png" alt="A chat on a phone" width="250">

  <sub>The landing, the library and a chat, on a phone.</sub>
</div>

<h2 align="center">Features</h2>

### Writing

- **Swipes and branching:** navigate alternative replies in the transcript, or copy a conversation up to a selected turn into an independent chat. Regenerate replaces the prior replies after a successful generation.
- **Composer:** per-chat drafts sync across devices, and input history recalls what you sent.
- **Search:** find-in-chat searches saved branches, and the chats panel finds chats and matching messages without opening them.

### Story state

- **Character versions:** save a variant of a character without duplicating the whole card.
- **Character Card V3:** import PNG/APNG, JSON and CHARX; export V3 PNG/JSON/CHARX or V2 compatibility cards. Preserves nickname, translated creator notes, sources, greetings, lorebooks and asset bytes.
- **Lorebooks:** standalone, shareable, keyword-triggered world info in SillyTavern's own format, with scan and budget knobs.
- **Steering:** guidance notes that ride the prompt, scoped globally, per character or per chat.
- **Chat memory:** select messages to summarize as chapters, then combine chapters into arcs and volumes. Saved summaries replace their source ranges in the prompt.

### The prompt

- **Prompt Builder:** order, toggle and edit every block that becomes the prompt.
- **Preset Controls:** author-made controls that let users adjust a preset without opening the full prompt builder.
- **Preset cards:** a preset exports as a PNG, art on the front and the document inside, like a character card.
- **Prompt debug panel:** every request and response lands here, with token counts corrected against what the provider reported.

<p><br></p>

<div align="center">
  <img src="images/roadmap-banner.png" alt="Roadmap: what comes next">
</div>

<br>

- **Extension system:** third-party extensions communicate with the app through a versioned, permissioned API.
- **Image generation:** scene and character art from inside the app.
- **Text to speech:** spoken replies, so a scene can be listened to instead of read.
- **Group chat:** several characters in one scene, taking turns.
- **Visual novel mode:** a separate system that works nothing like normal character roleplay, turning a scene into a visual novel the model drives.

## On SillyTavern

ChungusHub owes SillyTavern more than a mention. I built it as a SillyTavern user, out of things I admired there and things I wanted to see work another way. It speaks SillyTavern's formats because that is the library people already have, mine included until I moved fully to ChungusHub.

This project is **not** a fork of SillyTavern and shares none of its code.

---

> [!NOTE]
> Everything below is about running ChungusHub from source and working on it. If you only want to use the app, the download above is all you need.

## Getting started

### Requirements

[Bun](https://bun.sh/) 1.4.4 or newer. CI and release builds use 1.4.4. Earlier versions are affected by [CVE-2026-111497](https://github.com/oven-sh/bun/security/advisories/GHSA-663w-cv8g-jj2p).
The server and portable packaging refuse unsupported or prerelease runtimes before creating files or opening the database.

For an existing installation, update the Bun executable used to start the server and restart it.
Services and update scripts can point to a different executable from the `bun` on your shell's
`PATH`. Portable desktop servers embed Bun and must be rebuilt with the corrected runtime;
upgrading a separate Bun installation does not update them.

The source launchers (`start.bat` / `dev.ps1` on Windows, `start.command` on macOS and
`bash dev.sh` on Linux) handle Bun automatically. They reuse a compatible installation,
or download the approved version from the official Bun release and verify its SHA-256
before running it. They also install the locked project dependencies before starting.
An old global Bun is left untouched. Once provisioned, Bun needs no new download on
later launches unless the required version changes (installing project dependencies
may still need internet).

Private runtimes live under `%LOCALAPPDATA%/ChungusHub/runtime` on Windows,
`~/Library/Application Support/ChungusHub/runtime` on macOS, or
`${XDG_DATA_HOME:-~/.local/share}/chungushub/runtime` on Linux. `CHUNGUS_RUNTIME_DIR`
can select another absolute directory. Unix installers need `curl`, `unzip` and either
`sha256sum` or `shasum`. Downloads and version failures stop startup with an error;
they never fall back to an unsupported Bun.

For manual terminal commands, Bun can also be installed globally:

```sh
# Windows (PowerShell)
powershell -c "irm bun.sh/install.ps1 | iex"

# Linux / macOS
curl -fsSL https://bun.sh/install | bash
```

### Run it

```sh
git clone https://github.com/Tantoofaaz777/ChungusHub.git
cd ChungusHub
bun install --frozen-lockfile
bun run start
```

Then open <http://localhost:4242>. Your data lives in `user-data/` next to the repo.

Build output keeps progress, warnings and errors, while omitting the generated-file
size table and plugin timing reports. For the full diagnostic output, run
`CHUNGUS_BUILD_VERBOSE=1 bun run build` on Linux/macOS, or
`$env:CHUNGUS_BUILD_VERBOSE='1'; bun run build` in PowerShell. Unset the variable
afterwards to restore compact output (`Remove-Item Env:CHUNGUS_BUILD_VERBOSE` in PowerShell).

Alternatively, use the source launchers above without a manual Bun install. They start
the development frontend on <http://localhost:1420> and the backend on port 4242.

By default the app listens on loopback only. Turn on network access from Settings → Security when you want to reach it from other devices.

For an existing Cloudflare Tunnel running directly on the same VPS, stop ChungusHub and run:

```sh
bun run setup:tunnel chungus.example.com
bun run start
```

The setup command configures the hostname, disables automatic browser opening, keeps the server on loopback and disables the IP allowlist. It asks for a password with hidden input when none is set, or enables the existing password. Existing data paths and settings are preserved; existing settings get a `.before-tunnel` backup. You can also paste `https://chungus.example.com` into the command. To replace the password, add `--password`; a replacement signs out existing sessions. For automation, `--password-stdin` reads a new password from standard input instead of exposing it as a command argument.

In your existing tunnel, route the hostname to `http://127.0.0.1:4242` (or the local service printed by setup), set HTTP Host Header to the public hostname, and leave Protect with Access off and the route path empty. Open the public address and sign in with the ChungusHub password. No inbound app port needs to be opened.

Cloudflare Access is optional. To use it instead of setting a ChungusHub password, run setup with `--access`, create an Access self-hosted application that allows only your email, and enable Protect with Access on the tunnel route before publishing. This mode preserves existing password settings and sessions.

This command configures ChungusHub only; it does not change your Cloudflare account or install a service to keep the app running after SSH disconnects. If `cloudflared` runs in a container, its origin address must reach the host instead of the container's own loopback.

### Automatic Bun updates for an existing systemd service

From this repository, as the user named in the existing service's `User=` setting, run:

```sh
bash scripts/setup-updater.sh
```

Setup installs a `chungus-update` wrapper and a systemd drop-in pointing to the private,
stable `runtime/bin/bun` path. Existing files get a `.before-managed-runtime` backup
once; the base service and other overrides remain in place. Setup uses `sudo` only
for the service configuration and wrapper, and does not restart the running server.

Then run:

```sh
chungus-update
```

The updater pulls `main` with `--ff-only`, provisions the approved Bun if necessary,
installs locked dependencies, builds, and restarts only after those steps succeed.
It checks `/api/health` on loopback, without a public Host header or stored password.
The health port follows the service's `CHUNGUS_PORT` override or the repository's
configuration. `CHUNGUS_HEALTH_URL` can override the check for unusual setups.
For a service with another name, set `CHUNGUS_SERVICE_NAME` when running setup;
the installed wrapper remembers the service and runtime paths.

Future runtime updates happen during `chungus-update`, not during an unattended
systemd restart. A failed download leaves the previous executable in place and does
not restart the running service. This setup is for an existing service, not a new
systemd service installer. Portable server executables still need a new build because
their Bun runtime is embedded.

### Develop

Development runs as two processes, one per half of the app. Start them in separate terminals:

```sh
bun run server:dev   # server on :4242, restarts itself when server code changes
bun run dev          # client on :1420, hot reload
```

Then open <http://localhost:1420>.

`dev.ps1` on Windows and `dev.sh` on macOS and Linux do all of that in one window. `start.bat` and `start.command` are double-click wrappers for them.

`bun run check` type-checks the client and the server, and `bun test` runs the suite.

### Portable build

`bun run package` compiles a single executable with the Bun runtime embedded and lays it out in `dist/ChungusHub-portable/` with everything it needs beside it.

## Contributing

Contributions are welcome. For a larger change, open an issue first to discuss it before you spend the time; small fixes can come straight as a pull request.

1. Fork the project
2. Create your branch (`git checkout -b feature/my-feature`)
3. Commit your changes (`git commit -m 'feat: add my feature'`)
4. Push and open a pull request

Bug reports and feature requests through issues are worth just as much as code.

## License

Distributed under the GNU Affero General Public License v3.0. See [LICENSE](LICENSE).

The bundled typefaces are third-party and are not covered by that license. Each is under the SIL Open Font License, Version 1.1, and their copyright notices sit with them in [static/fonts/OFL.txt](static/fonts/OFL.txt).

## Contact

For this fork, use [GitHub issues](https://github.com/Tantoofaaz777/ChungusHub/issues). For security reports, see [SECURITY.md](SECURITY.md).

Original ChungusHub author: **Patcireamo**. The upstream project's community and releases belong to the original project.
