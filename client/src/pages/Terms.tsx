import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Shield } from 'lucide-react';
import { PageMeta } from '../components/seo/PageMeta';

export const Terms = () => {
  return (
    <>
    <PageMeta
      title="Termos de Uso"
      description="Leia os termos de uso e política de privacidade da Vértice Invest, plataforma de análise quantitativa de Ações, FIIs e Criptomoedas."
      canonical="/terms"
    />
    <div className="w-full max-h-[500px] overflow-y-auto pr-3 custom-scrollbar">
      <div className="mb-6 flex items-center gap-2 sticky top-0 bg-white/95 backdrop-blur-sm z-20 pb-2 pt-1 border-b border-slate-100">
        <Link to="/register" className="p-2 -ml-2 hover:bg-slate-100 rounded-full transition-colors text-slate-500">
            <ArrowLeft size={20} />
        </Link>
        <div>
            <h2 className="text-xl font-bold text-slate-900 tracking-tight">Termos de Uso</h2>
            <p className="text-slate-500 text-[10px] font-medium uppercase tracking-wider">Versão 1.1 — Agosto de 2026</p>
        </div>
      </div>

      <div className="prose prose-sm prose-slate text-slate-600 pb-4">
        <div className="bg-blue-50 p-4 rounded-lg border border-blue-100 mb-6 flex gap-3">
            <Shield className="text-blue-600 shrink-0" size={24} />
            <p className="text-xs text-blue-800 font-medium m-0">
                A Vértice Invest é uma plataforma de tecnologia financeira. Não atuamos como banco ou corretora de valores mobiliários.
            </p>
        </div>

        <h3 className="text-slate-900 font-bold text-base mb-2">1. Aceitação dos Termos</h3>
        <p className="mb-4">Ao acessar e usar a plataforma Vértice Invest, você concorda em cumprir e ficar vinculado aos seguintes termos e condições. O uso contínuo da plataforma constitui aceitação tácita de quaisquer atualizações nestes termos.</p>

        <h3 className="text-slate-900 font-bold text-base mb-2">2. Uso da Plataforma</h3>
        <p className="mb-4">Você concorda em usar nossa plataforma apenas para fins legais e de maneira que não infrinja os direitos de terceiros ou restrinja o uso da plataforma por qualquer outra pessoa. É proibido o uso de técnicas de scraping, engenharia reversa ou automação não autorizada.</p>

        <h3 className="text-slate-900 font-bold text-base mb-2">3. Propriedade Intelectual</h3>
        <p className="mb-4">Todo o conteúdo, incluindo algoritmos de IA, designs, códigos-fonte, logotipos e análises proprietárias são propriedade exclusiva da Vértice Invest. O uso não autorizado pode violar leis de direitos autorais e propriedade industrial.</p>

        <h3 className="text-slate-900 font-bold text-base mb-2">4. Isenção de Responsabilidade Financeira</h3>
        <p className="mb-4">As informações fornecidas por nossa IA são baseadas em dados históricos e estatísticos e servem apenas para fins informativos. <strong>Investimentos envolvem riscos de perda de capital.</strong> Resultados passados não garantem retornos futuros. A Vértice Invest não se responsabiliza por perdas financeiras decorrentes de decisões tomadas com base em nossa plataforma.</p>

        <h3 className="text-slate-900 font-bold text-base mb-2">5. Privacidade e Dados</h3>
        <p className="mb-4">Respeitamos sua privacidade e protegemos seus dados conforme a LGPD. Coletamos apenas informações necessárias para a prestação do serviço e segurança da conta (como logs de acesso e auditoria). Seus dados pessoais nunca serão vendidos a terceiros sem seu consentimento explícito.</p>
        
        {/* Cláusula de cobrança (31/08/2026). A plataforma vendia assinatura mensal
            recorrente e um anual parcelado em 12× sem nenhum texto que dissesse o que
            renova, o que não renova e o que acontece ao cancelar — e a Landing anuncia
            "Cancele quando quiser", que sozinho sugere devolução. Preço NÃO se escreve
            aqui: fica na vitrine, que é espelhada por teste com o servidor. */}
        <h3 className="text-slate-900 font-bold text-base mb-2">6. Assinaturas, Cobrança e Cancelamento</h3>
        <p className="mb-3">Os valores vigentes de cada plano estão na <Link to="/pricing" className="text-blue-600 hover:underline font-medium">página de planos</Link>. O pagamento é processado pelo Mercado Pago; não recebemos nem armazenamos os dados do seu cartão.</p>
        <ul className="mb-4 space-y-1.5 pl-5 list-disc marker:text-slate-400">
          <li><strong>Mensal no cartão:</strong> assinatura recorrente, renovada automaticamente a cada período até que você cancele.</li>
          <li><strong>Mensal no Pix:</strong> pagamento avulso que libera 30 dias de acesso e não renova sozinho.</li>
          <li><strong>Anual:</strong> cobrança única que libera 365 dias, parcelável em até 12× no cartão. <strong>Não renova automaticamente.</strong> Se houver uma assinatura mensal ativa, ela é cancelada na contratação do anual, para que não haja cobrança dupla.</li>
        </ul>
        <p className="mb-4"><strong>Direito de arrependimento.</strong> Nos 7 dias corridos seguintes à contratação, você pode desistir e receber de volta o valor pago, conforme o art. 49 do Código de Defesa do Consumidor. Basta solicitar por <a href="mailto:contato.verticeinvest@gmail.com" className="text-blue-600 hover:underline font-medium">contato.verticeinvest@gmail.com</a>.</p>
        <p className="mb-4"><strong>Cancelamento.</strong> Pode ser feito a qualquer momento no seu perfil, sem multa nem fidelidade. O cancelamento interrompe as cobranças futuras e o acesso continua até o fim do período já pago. Passado o prazo de arrependimento, não há devolução proporcional do período em curso.</p>
        <p className="mb-4"><strong>Mudança de plano e de preço.</strong> Ao contratar um novo período avulso, os dias que ainda restam do seu plano atual são somados ao novo — você não perde o que já pagou. Mudanças de preço não alteram assinaturas já autorizadas: o novo valor vale para contratações futuras.</p>
        <p className="mb-4"><strong>Falta de pagamento.</strong> Se uma cobrança não for aprovada, o acesso continua até o fim do período já pago. Sem novo pagamento, a conta retorna ao plano gratuito e seus dados de carteira permanecem preservados.</p>

        <h3 className="text-slate-900 font-bold text-base mb-2">7. Encerramento de Conta</h3>
        <p className="mb-4">Reservamo-nos o direito de suspender ou encerrar sua conta a qualquer momento, sem aviso prévio, em caso de violação destes termos ou suspeita de atividade fraudulenta.</p>
      </div>

      <div className="mt-4 pt-6 border-t border-slate-100 text-center sticky bottom-0 bg-white/95 backdrop-blur-sm pb-2">
        <Link to="/register" className="inline-block px-6 py-2.5 bg-slate-900 text-white text-sm font-bold rounded-lg hover:bg-slate-800 transition-colors shadow-lg shadow-slate-900/20">
            Concordar e Voltar
        </Link>
      </div>
    </div>
    </>
  );
};