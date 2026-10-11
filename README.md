# Atölye

Claude Code için 3D terminal giydirmesi. Solda bir oda var: sen masandasın, `claude`
yazınca Claude kapıdan girip yanına oturuyor, ajan çalıştırınca küçük robotlar gelip
yan masalara geçiyor. Sağda gerçek terminalin duruyor.

## Çalıştırma

```sh
npm install   # node-pty Electron için otomatik derlenir
npm start
```

Sahneyi Claude açmadan görmek için üstteki **Demo** düğmesine bas.

## Nasıl çalışıyor

- `main.js` kabuğu `node-pty` ile açar ve yerel bir HTTP sunucusu başlatır.
- Atölye terminalinde `claude` komutu `--settings` ile sarılır. Hook'lar yalnızca burada
  devreye girer; `~/.claude/settings.json` dosyana dokunulmaz.
- Her hook `hooks/emit.sh` üzerinden olayı uygulamaya yollar. `renderer/director.js` olayı
  davranışa çevirir, `renderer/scene.js` de odayı ve karakterleri çizer.

| Olay | Sahnede |
|---|---|
| SessionStart | Claude kapıdan girer, el sallar, oturur |
| UserPromptSubmit | Sen yazdığını söylersin, Claude dinler, sonra düşünür |
| Edit / Write | Claude kendi klavyesinde yazar |
| Read / Grep / Glob | Ekrana bakıp düşünür |
| Bash | Sunucu rafını kurcalar |
| WebSearch / WebFetch / Skill | Kitaplıktan kitap okur |
| PermissionRequest / AskUserQuestion | Sana dönüp el kaldırır |
| SubagentStart / Stop | Ajan gelir, masaya oturur; bitince rapor verip çıkar |
| Stop | Kahve molası, sonra arkasına yaslanır |
| SessionEnd | Vedalaşıp çıkar |
