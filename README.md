# Aristide Benoist Clone

Standalone reconstruction of `https://aristidebenoist.com/` created from measured browser references and locally stored approved assets.

## Commands

```powershell
npm.cmd install
npm.cmd run assets:verify
npm.cmd run dev
npm.cmd run check
```

Research artifacts and visual references live under `docs/`.
Run `npm.cmd run assets:download` to restore missing remote assets from the
recorded manifest. Existing files are preserved unless `-- --force` is passed.
