# Chungus para Android

Cliente Kotlin + WebView para o mesmo servidor HTTPS usado pelo navegador. Não tem banco
local, não copia chats e não exige sincronização manual. A interface vem da VPS, inclusive
suas atualizações. As mudanças nativas exigem um novo APK.

## Instalar e testar no celular

1. Copie `Chungus-Android-test.apk` para o celular e abra o arquivo para instalar.
2. Se o Android pedir, permita que o app usado para abrir o arquivo instale aplicativos.
3. Abra **Chungus**, informe o endereço HTTPS que você já usa no navegador e toque em **Connect**.
4. Faça o login normal do seu servidor, caso esteja protegido por senha.

Android 8 ou superior, com Android System WebView/Chrome atualizado. O APK de teste usa a
assinatura de depuração do Android; uma futura distribuição definitiva terá assinatura própria.

O teste principal é abrir o mesmo chat no Android e Windows e conferir mensagens e memórias.
Depois teste teclado, Voltar, importação de PNG/JSON/ZIP, exportação e reimportação de um arquivo.
O app não mantém a CPU acordada em segundo plano; a geração continua no servidor conforme
o comportamento atual do Chungus.

**Voltar:** primeiro fecha o teclado. Depois, fecha o diálogo/editor/painel mais interno,
volta à home e, por último, deixa o app em segundo plano. A integração completa depende
de publicar também os arquivos do frontend desta mudança na VPS. Com um frontend antigo,
o app ainda abre o servidor e trata os arquivos, mas a navegação interna é limitada.

Para configurar outro servidor: **Settings → Android app**. Sem acesso ao site, segure o
ícone do aplicativo no launcher e escolha **Chungus server**. Essa configuração
mantém a página atual aberta até você tocar em Connect. A interface nativa é em inglês.

Na versão 0.1.1, o contêiner nativo consome os insets depois de aplicar a proteção das
barras e do teclado. Isso evita que a WebView repita o espaçamento pelas áreas seguras CSS.
As barras de status e navegação do Android continuam visíveis.

Na versão 0.1.2, a exportação de personagens abre o seletor de destino antes de buscar
o retrato e gerar o PNG/JSON/CHARX ou ZIP. Cancelar o seletor não gera o arquivo. Depois
de escolher o destino, a preparação e a gravação continuam com o botão Export ocupado.
Esse fluxo exige também atualizar a interface na VPS; versões anteriores continuam compatíveis.

Na versão 0.1.3, o Android informa à interface quando o app sai e volta ao primeiro plano.
A interface pausa o heartbeat e as tentativas automáticas de reconectar enquanto estiver
oculta; ao voltar, verifica o socket existente ou reconecta imediatamente se ele fechou.
Gerações continuam na VPS e são retomadas sem enviar uma segunda solicitação. Essa melhoria
também exige atualizar a interface na VPS. O Android ainda pode suspender a rede em segundo plano.

Na versão 0.1.4, os botões de copiar usam a área de transferência nativa do Android.
O app só confirma a cópia depois de gravar e conferir o próprio texto, sem depender
da confirmação da API do WebView. Textos longos são enviados em blocos com confirmação;
falhas e falta de resposta aparecem como erro. É necessário instalar o APK novo e
atualizar a interface na VPS. APKs anteriores continuam usando a cópia do navegador.

## Abrir no Android Studio

Abra esta pasta `android/` como projeto. O Gradle usa JDK 21 (critério declarado em
`gradle/gradle-daemon-jvm.properties`) e o Android SDK 36. O SDK e o JDK já estavam instalados
no computador usado para a primeira compilação. `local.properties`, caches e APKs não são
versionados. No Android Studio, a opção de gerar APK produz `app/build/outputs/apk/debug/app-debug.apk`.

No terminal, com JDK 21 e Android SDK configurados:

```powershell
.\gradlew.bat :app:assembleDebug :app:testDebugUnitTest :app:lintDebug
```

Não é preciso executar o build web para compilar o APK: ele carrega a interface da VPS.

## Arquitetura

- `MainActivity.kt`: endereço, sessão WebView, teclado/insets, Voltar e seletor de importação.
- `ServerAddress.kt`: validação HTTPS e comparação exata de origem.
- `DocumentExports.kt`: seletor de destino do Android e escrita em uma thread de IO.
- `assets/client.js`: adaptador dos downloads existentes (blob, data URI e HTTP da mesma origem).
- `../src/lib/services/android-client.ts`: integração opcional com a navegação web e configuração nativa.

A ponte só existe na origem HTTPS configurada e só atende ao frame principal. Links externos
abrem em outro aplicativo. Certificados inválidos são recusados. Não há permissão ampla de
armazenamento, câmera ou microfone. Importação e exportação usam o seletor de documentos do
Android. Sessões ficam no armazenamento privado do WebView e o backup automático do Android
é desativado. Credenciais de HTTP Basic Auth não são gravadas pelo código do cliente.

Exports são enviados em blocos de no máximo 48 KiB, confirmados individualmente. O arquivo
é escrito no destino escolhido, sem montar uma segunda cópia completa em base64. Cancelamentos,
navegação e falhas encerram a transferência e removem o documento parcial quando possível.
Arquivos gerados por `Blob` preservam o conteúdo original, incluindo metadados de PNG.

Não foi usado código do Aventuras ou do SillyTavern-Android. A estrutura segue as APIs
oficiais de WebView, AndroidX Activity, AndroidX WebKit e Storage Access Framework.
