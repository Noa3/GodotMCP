# Windows installation

Follow the [canonical local installation](../README.md#one-supported-installation-route). From the built server checkout:

```powershell
node dist/cli/index.js install "D:\Games\MyGame" --enable
```

Replace that example path with your actual game directory. The installer uses the real Node executable and handles spaces through argument arrays; it does not invoke `npx.cmd` or an unverified package. Close Godot before install/upgrade. The dock copies generated local configuration for VS Code or generic MCP clients. Reinstall after moving the checkout or game.
