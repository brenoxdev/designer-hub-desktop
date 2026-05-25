# Designer Hub Desktop (Electron)

App desktop do Designer Hub. Abre o sistema numa janela nativa (Windows e Mac),
conecta automaticamente ao servidor, faz backup local e **funciona offline**.

## O que o app faz

- **Conexao automatica** — ao abrir, ja carrega o sistema direto.
- **Animacao de abertura** — um splash do Designer Hub aparece enquanto o app
  conecta no servidor.
- **Janela sem moldura** — o app abre sem a barra cinza do Windows. No lugar
  dela, uma barra de titulo propria, fininha e escura, com a cara do Designer Hub
  e os botoes minimizar / maximizar / fechar integrados. No macOS os botoes
  nativos (semaforo) sao mantidos.
- **App liso** — sem menu nativo. Os controles (Backup, Abrir pasta, Recarregar)
  ficam numa barrinha discreta no rodape do menu lateral, logo **acima do seu
  perfil** — longe do botao "Sair". Atalhos: Ctrl/Cmd+B e Ctrl/Cmd+R.
- **Botao de suporte** — fala direto com voce (Brenox) pelo WhatsApp, tanto no
  sistema quanto na tela offline.
- **Backup local automatico** — a cada 30 min, salva as planilhas em
  `Documentos/Designer Hub - Backups`.
- **Funciona offline** — veja abaixo.
- **Atualizacao automatica** — via GitHub Releases (veja a secao adiante).
- **DevTools desabilitado**.

## Como funciona offline (sincronizacao)

O app foi pensado pra voce nao parar de trabalhar quando a internet cai:

1. **Quando online**, o app mantem uma copia local (cache) dos seus clientes e
   pacientes — atualizada a cada 5 minutos.
2. **Quando a conexao cai**, o app abre a tela "Modo offline", onde voce continua
   cadastrando trabalhos normalmente: escolhe um cliente (da lista em cache) ou
   cria um novo, informa o paciente e adiciona as proteses. Cada cadastro entra
   numa **fila local**, salva no seu computador.
3. **Quando a internet volta**, o app detecta sozinho (testa a cada 30s) e
   **envia toda a fila** para o servidor automaticamente — cria os clientes,
   pacientes e proteses que voce cadastrou offline. Tambem da pra forcar pelo
   botao "Sincronizar agora".

Os dados ficam em `cache.json` e `outbox.json` na pasta de dados do app.

**O que esta coberto:** criar trabalhos offline (cliente -> paciente -> proteses)
e envia-los ao reconectar. Isso cobre o caso real de uso (cadastrar trabalhos
quando a rede cai). **O que nao esta nesta versao:** editar registros que ja
existem no servidor enquanto offline — isso exigiria mesclagem de conflitos e
fica como evolucao futura, se necessario.

## Endereco do servidor

Vem configurado para `https://designerhub.shardweb.app`. Se mudar, edite **apenas**
esta linha no `main.js`:
```js
const SERVER_URL = 'https://designerhub.shardweb.app';
```

## Numero do suporte (WhatsApp)

O botao "Suporte" abre uma conversa de WhatsApp com voce. Coloque o seu numero
**em dois lugares** (so digitos, com o 55 do Brasil na frente — ex: `5511999998888`):

1. No `main.js`: `const SUPPORT_WHATSAPP = '...';`
2. No `cliente-hub/public/app.js`: `const SUPPORT_WHATSAPP = '...';`

## Rodar em desenvolvimento

```bash
cd brenox-hub-desktop
npm install
npm start
```

## Gerar os instaladores

### Windows (.exe)
Em um PC **Windows**: `npm install` e depois `npm run dist:win`
Instalador: `dist/DesignerHub-Setup-1.3.0.exe`

### macOS (.dmg)
Em um **Mac**: `npm install` e depois `npm run dist:mac`
Arquivo: `dist/DesignerHub-1.3.0.dmg`

## Atualizacao automatica (GitHub Releases)

O app verifica se ha versao nova ao abrir e atualiza sozinho. Ja vem
configurado para o repositorio `brenoxdev/designer-hub-desktop`. Passos:

1. Crie o repositorio **publico** `designer-hub-desktop` na conta `brenoxdev`.
2. Gere um token do GitHub (com permissao `repo`) e exporte:
   `export GH_TOKEN=seu_token` (Windows: `set GH_TOKEN=...`).
3. Para publicar: aumente a `version` no `package.json` e rode `npm run publish`.

Os usuarios recebem a atualizacao automaticamente na proxima vez que abrirem.

## Icone do app

Ja vem pronto na pasta `build/` (`icon.ico` para Windows e `icon.png` 512x512
para macOS). O `electron-builder` usa esses arquivos automaticamente.

## Estrutura

```
brenox-hub-desktop/
  package.json     # config do electron-builder
  main.js          # processo principal: janela, backup, cache, fila offline, sync
  preload.js       # ponte segura + barra de titulo propria + barra de controle
  renderer/
    splash.html    # animacao de carregamento inicial
    offline.html   # tela de cadastro offline + fila de envio
```
