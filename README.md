[README.md](https://github.com/user-attachments/files/35044822/README.md)
# ChatFilipe — atalhos para o Radmin

Esta pasta não contém agente, serviço nem servidor. O painel `chatfilipe.html` gere os dispositivos por IP e inclui atalhos para abrir o **Radmin Viewer**.

## Como funciona

Cada cartão do painel tem dois botões:

- **Abrir no Radmin** — abre o Radmin Viewer diretamente. Requer executar `registar-protocolo.reg` uma vez (registo por utilizador, sem administrador).
- **Copiar comando Radmin** — cópia direta, sem precisar de registo nenhum. Cola no `Executar` do Windows (Win+R):



```
"C:\Users\JCPereira\Desktop\Filipe Pereira\ChatFilipe\conectar-radmin.cmd" 192.168.1.50 4899
```

O `.cmd` localiza o `radmin.exe` nas pastas habituais e chama:

```
radmin.exe /connect:<IP>:<porta>
```

## Requisitos

- **Radmin Viewer** instalado neste PC.
- **Radmin Server** instalado e com palavra-passe no PC de destino — a ligação é recusada sem isso.
- A porta predefinida do Radmin é **4899**; podes passar outra como segundo argumento.

## Segurança

- Não há instalação silenciosa, ocultação, persistência ou evasão.
- O Radmin mostra sempre a ligação ao utilizador do PC remoto.
- Só liga a máquinas onde o Radmin Server esteja autorizado pelo respetivo dono.
