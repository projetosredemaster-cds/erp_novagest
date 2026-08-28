// style-system: Tailwind
import { useState } from 'react';

// eslint-disable-next-line react-refresh/only-export-components
export const MOTIVOS_PERDIDO = [
  { value: 'nao_foi_loja', label: 'Não foi à loja' },
  { value: 'foi_loja_nao_comprou', label: 'Foi à loja mas não comprou' },
  { value: 'preco_condicao', label: 'Preço/condição de pagamento' },
  { value: 'comprou_outro_lugar', label: 'Comprou em outro lugar' },
  { value: 'desistiu_sem_resposta', label: 'Desistiu/sem resposta depois' },
  { value: 'outro', label: 'Outro' },
];

const btn = "bg-gray-900 text-white border-none rounded-lg px-4 py-2.5 text-[13px] font-bold cursor-pointer hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50";
const btnGhost = "bg-transparent border border-gray-300 text-gray-700 rounded-lg px-3.5 py-2.5 text-[13px] font-semibold cursor-pointer hover:bg-gray-100";
const selectCls = "w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 focus:outline-none focus:border-gray-500";
const textareaCls = "w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 resize-none focus:outline-none focus:border-gray-500";

export default function ModalMotivoPerdido({ onConfirmar, onCancelar }) {
  const [motivo, setMotivo] = useState('');
  const [motivoDetalhe, setMotivoDetalhe] = useState('');

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="modal-motivo-perdido-title"
      onClick={onCancelar}
    >
      <div
        className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="modal-motivo-perdido-title" className="mb-3 text-[17px] font-bold text-gray-900">
          Motivo da perda
        </h2>

        <div className="mb-3">
          <label htmlFor="motivo-perdido-select" className="mb-1 block text-[12px] font-semibold text-gray-600">
            Motivo
          </label>
          <select
            id="motivo-perdido-select"
            className={selectCls}
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
          >
            <option value="">Selecione um motivo</option>
            {MOTIVOS_PERDIDO.map((m) => (
              <option key={m.value} value={m.value}>{m.label}</option>
            ))}
          </select>
        </div>

        <div className="mb-4">
          <label htmlFor="motivo-perdido-detalhe" className="mb-1 block text-[12px] font-semibold text-gray-600">
            Detalhe (opcional)
          </label>
          <textarea
            id="motivo-perdido-detalhe"
            className={`${textareaCls} min-h-[70px]`}
            value={motivoDetalhe}
            onChange={(e) => setMotivoDetalhe(e.target.value)}
          />
        </div>

        <div className="flex justify-end gap-2">
          <button type="button" className={btnGhost} onClick={onCancelar}>Cancelar</button>
          <button
            type="button"
            className={btn}
            disabled={!motivo}
            onClick={() => onConfirmar(motivo, motivoDetalhe || null)}
          >
            Confirmar
          </button>
        </div>
      </div>
    </div>
  );
}
