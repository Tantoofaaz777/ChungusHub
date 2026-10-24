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
A geração continua no servidor e não mantém a CPU do celular acordada. Durante uma leitura
em voz alta, o serviço de áudio usa apenas os recursos necessários para preparar e reproduzir a fala.

### Leitura em voz alta (0.1.8)

Com o APK 0.1.8 e a interface atualizada na VPS, as ações de cada mensagem mostram
**Read aloud**. A leitura usa o motor e a voz padrão configurados no Android. A barra
abaixo da navegação permite voltar uma frase, pausar/continuar, avançar uma frase e parar.
Frases muito longas são divididas em trechos menores. A pausa preserva o ponto do áudio.
Nesta primeira versão, voz, idioma e velocidade seguem os padrões do motor do Android.

A leitura continua ao trocar de aplicativo ou apagar a tela. Os mesmos comandos ficam
disponíveis pelo player de mídia do sistema; nos Samsung compatíveis, testar também a
aparição na Now Bar e a expansão ao tocar. O visual e a disponibilidade dependem da One UI.
Não há pílula flutuante externa nem permissão de sobreposição. A notificação é somente
do player, sem notificações de novas mensagens.

O texto lido vem da mensagem original, com macros de identidade resolvidos e sem aplicar regex de display. Markdown, tags HTML, comentários HTML, reasoning e URLs de imagens não são lidos.
A fala é preparada em arquivos temporários privados, apagados ao parar, concluir ou trocar
de mensagem. Nada é enviado para uma API de áudio na VPS. Algumas vozes do próprio motor
Android podem precisar de internet; instale uma voz offline se desejar evitar isso.
A leitura para ao trocar a origem do servidor e após dez minutos em pausa.

Para testar no celular: iniciar uma leitura longa, pausar no meio de uma palavra e retomar;
voltar/avançar frases; minimizar; apagar a tela; usar os controles de mídia e da Now Bar;
receber uma interrupção de áudio e desconectar os fones. Verificar também o bloqueio por
biometria ao voltar, sem interromper uma leitura já iniciada. Não há reprodução automática
após encerrar o serviço/processo.

### Voz e velocidade (0.1.9)

Em **Settings → TTS**, escolha uma voz do motor padrão de TTS do Android e a velocidade
de leitura entre **0.5× e 2×**, com padrão **1×**. O filtro de idioma só reduz a lista de
vozes; não muda a seleção sozinho. As vozes indicam **Online** ou **Offline** conforme
o próprio motor. **Android default** volta à voz padrão. Não há ajuste de pitch.

As escolhas são salvas automaticamente apenas neste Android e valem na próxima leitura
iniciada com **Read aloud**, preservando a reprodução atual. O slider usa a mesma proteção
global de toque do restante do app: rolar verticalmente não ajusta a velocidade.
**Refresh voices** atualiza a lista após instalar vozes ou trocar o motor padrão nas
configurações do Android. Uma voz removida precisa ser substituída ou voltar ao padrão.
Esta página exige atualizar a interface na VPS e instalar o APK 0.1.9 ou posterior.

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

Na versão 0.1.5, mensagens e feeds ganham **Share** ao lado de Copy. O feed continua
sendo convertido para texto simples antes do envio. No diálogo de exportação de
personagens, **Share** envia o PNG/JSON/CHARX ou ZIP preparado para o menu de
compartilhamento do Android; **Export** continua salvando pelo seletor de arquivos.
Textos muito grandes são compartilhados como arquivo `.txt` para respeitar o limite
de transações do Android. Abrir o menu não confirma que outro aplicativo recebeu o conteúdo.

O app também recebe PNG/APNG, JSON e CHARX via **Compartilhar → Chungus**. O Android
guarda uma cópia privada até a interface estar aberta e autenticada. Um diálogo
mostra os arquivos e o servidor de destino; **Import** usa o importador de personagens
normal, com a opção de incluir lorebooks. Cancelar descarta só as cópias temporárias.
São aceitos até 20 arquivos pendentes, de até 128 MiB cada e 256 MiB no total.
É preciso atualizar também a interface da VPS para usar estas funções.

### Bloqueio por senha e biometria

Em **Settings → Android app → App lock**, ative **Require unlock** e confirme a
senha do próprio servidor. Esse bloqueio é opcional e exclusivo deste Android:
não muda o prazo de sessão do navegador nem as configurações globais da VPS.
O servidor precisa ter uma senha configurada no Chungus.

Uma nova abertura do processo pede desbloqueio. Ao trocar de app ou apagar a tela,
**Lock after leaving the app** oferece Immediately, 30 seconds, 1 minute (padrão),
5 minutes e 15 minutes. Voltar antes do prazo preserva o acesso. O relógio usado
inclui o tempo de suspensão e não depende de ajustes na hora do celular.

**Biometric unlock** é opcional e usa uma biometria forte cadastrada no Android.
Na ativação, a senha é confirmada no servidor e criptografada com AES-GCM por uma
chave do Android Keystore que exige autorização biométrica em cada uso. O arquivo
criptografado e a chave são vinculados à origem HTTPS exata; uma mudança de servidor
não envia a credencial antiga ao endereço novo. A senha nunca passa pela ponte JavaScript.
Cada desbloqueio, por senha ou biometria, faz um novo login real no servidor. Uma senha
alterada ou chave invalidada pede a senha novamente; ausência ou cancelamento de
biometria mantém a alternativa de senha do servidor, sem usar o PIN do celular.

O app protege a prévia nas telas recentes. Uma escolha de
arquivo que retornar depois do prazo espera o desbloqueio antes de continuar.
O chat permanece carregado para preservar posição, rascunho e geração em andamento.
Este bloqueio é nativo e não exige atualizar a interface da VPS. Ele vem desligado
para instalações existentes; ative-o neste aparelho depois de instalar o APK novo.

Na versão 0.1.6, perder o foco não mostra o formulário de desbloqueio durante a
animação de minimizar ou atrás da confirmação de adicionar um atalho. O prazo de
bloqueio começa em `onStop`, quando o app fica totalmente oculto. Uma confirmação
translúcida do Android, sem saída real do app, não inicia esse prazo. A janela
continua protegida contra captura da prévia em segundo plano; o formulário só
aparece ao retornar com o bloqueio ativo. Esta correção exige apenas o APK novo.

Na versão 0.1.7, a biometria abre automaticamente ao chegar à tela de desbloqueio,
se estiver ativada e disponível. O app espera estar em primeiro plano e com foco;
não abre o prompt ao minimizar ou durante diálogos do Android. Cancelar ou receber
um erro mantém a senha disponível, sem repetir a tentativa automática nesse mesmo
bloqueio. O botão **Unlock with biometrics** permite tentar novamente. Depois de
um desbloqueio bem-sucedido, um novo bloqueio volta a oferecer a biometria automaticamente.
Esta melhoria exige apenas instalar o APK novo, sem atualizar a VPS.

### Atalhos de chats

No app Android, **Chat actions → Add to home screen** pede ao launcher para fixar
um atalho com o nome do chat e o ícone do Chungus. A confirmação e a posição final
ficam com o launcher. Pedir novamente para o mesmo chat atualiza o mesmo identificador,
inclusive após renomeá-lo, em vez de criar um destino diferente.

Tocar no atalho abre o chat depois do desbloqueio e do carregamento autenticado da
interface. Também funciona com o app já aberto. Gerações em andamento continuam no
chat de origem; editores e diálogos que impedem navegação são respeitados. Um chat
excluído mostra um aviso e mantém a conversa atual. O atalho é vinculado ao servidor
onde foi criado: se você configurar outro endereço, reconecte ao servidor original
antes de usar seus atalhos. Ele não troca silenciosamente o servidor configurado.

O launcher recebe um identificador de registro privado, sem senha, cookie ou URL de
login. Reinstalar o app remove esses registros, então é necessário recriar os atalhos.
Esta função exige o APK novo e a atualização correspondente da interface na VPS;
navegadores e APKs antigos não exibem o botão.

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
- `NativeShares.kt` / `SharedInbox.kt`: envio pelo Sharesheet com `FileProvider` e fila privada de arquivos recebidos.
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


### Processamento do texto para leitura (0.1.9)

Em **Settings > TTS > Text processing**, adicione regras para remover palavras, frases ou padrões regex apenas da fala. A mensagem original não é alterada. As regras são locais ao aparelho, não são enviadas ao servidor e valem para todos os chats desse Android.

- As regras são aplicadas de cima para baixo, cada uma recebe o resultado da anterior. Arraste pela alça para reordenar, inclusive por toque; a área de texto continua disponível para rolagem.
- **Text** remove todas as ocorrências literais, inclusive dentro de outras palavras. **Match case** diferencia maiúsculas e minúsculas.
- **Regex** usa sintaxe JavaScript, sem delimitadores `/`, com correspondência global. Por exemplo, `\[[^\]]*\]` remove trechos entre colchetes, inclusive com quebras de linha.
- Use os switches para desativar regras sem apagá-las. Há limite de 30 regras e 1.000 caracteres por padrão.
- **Save rules** valida e salva a lista inteira, incluindo a ordem. Edições ainda não salvas não mudam a fala.
- **Preview draft rules** permite conferir o texto final usando texto simples e as regras atuais, antes de salvar. A prévia não inicia áudio.
- A execução fica em um worker descartável, com limite de tempo. Se uma regex for inválida ou demorar demais, a leitura não começa; nenhum texto sem filtragem é enviado como fallback.
- O processamento ocorre depois da conversão da mensagem original em texto simples, sem aplicar regex de display, e antes da divisão em frases. Avançar/voltar usa apenas as frases restantes. A leitura atual não é alterada por novas regras.

Atualize a interface na VPS e instale o APK 0.1.9 para disponibilizar todos esses controles.
