const MENSAGEM_SENHA_FRACA =
  'A senha deve ter no mínimo 6 caracteres e incluir ao menos uma letra maiúscula, um número e um caractere especial.';

function senhaAtendeComplexidade(senha) {
  if (typeof senha !== 'string' || senha.length < 6) {
    return false;
  }

  const temMaiuscula = /[A-Z]/.test(senha);
  const temNumero = /[0-9]/.test(senha);
  const temCaractereEspecial = /[^A-Za-z0-9]/.test(senha);

  return temMaiuscula && temNumero && temCaractereEspecial;
}

module.exports = {
  senhaAtendeComplexidade,
  MENSAGEM_SENHA_FRACA,
};
