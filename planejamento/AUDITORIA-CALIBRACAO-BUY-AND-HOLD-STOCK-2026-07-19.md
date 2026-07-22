# Auditoria de Calibração — Buy and Hold em Ações BR

**Data do diagnóstico:** 19/07/2026  
**Escopo:** ranking `STOCK`, com aprofundamento em `ITUB4`, `BBSE3` e pares financeiros  
**Status:** diagnóstico concluído; nenhuma regra, peso, threshold, dado ou ranking de produção foi alterado  
**Referência:** complementa `PROMPT-MESTRE-AUDITORIA-RANKING-END-TO-END.md` e `planejamento/AUDITORIA-RANKING-END-TO-END-2026-07-19.md`

---

## 1. Pergunta que esta auditoria responde

O fato de existirem somente quatro `BUY` no perfil Defensivo significa que o modelo identificou corretamente apenas quatro boas oportunidades de compra, ou o sistema está deixando de reconhecer empresas adequadas para buy and hold por problemas de dados, aplicabilidade setorial ou desenho do ranking?

A auditoria não parte da premissa de que `ITUB4`, `BBSE3` ou qualquer outro ativo precisa receber `BUY`. Os ativos são casos de controle para verificar se o modelo:

1. reconhece corretamente qualidade e durabilidade;
2. usa métricas economicamente comparáveis ao setor;
3. separa empresa boa de preço de entrada atraente;
4. preserva disciplina de risco e diversificação;
5. consegue explicar por que um ativo ficou fora do Top 10.

Também não existe meta mínima de `BUY`. O threshold global continua sendo 70 nesta auditoria. A quantidade de recomendações deve ser consequência dos dados e não um objetivo de calibração.

---

## 2. Contrato de buy and hold adotado

Para o Vértice, uma análise buy and hold precisa avaliar pelo menos cinco dimensões distintas:

| Dimensão | Pergunta econômica |
|---|---|
| Durabilidade | O modelo de negócio tem capacidade de continuar relevante e lucrativo por muitos anos? |
| Qualidade e recorrência | A empresa produz retorno sobre o capital e lucro recorrente através de diferentes ciclos? |
| Solidez | O balanço, o capital regulatório, a liquidez e os riscos suportam choques? |
| Governança e alocação | Controladores e administradores tratam bem o capital e os minoritários? |
| Preço de entrada | A cotação oferece retorno esperado e margem de segurança compatíveis com o risco? |

Uma empresa pode ser excelente para acompanhar ou possuir por muitos anos e, ainda assim, estar cara para iniciar ou aumentar posição hoje. Portanto:

- `qualidade para possuir` não é sinônimo de `BUY agora`;
- `BUY` deve continuar significando oportunidade quantitativa de entrada para o perfil;
- um `WAIT` não deve ser comunicado como “empresa ruim”;
- qualidade/durabilidade e atratividade de entrada precisam ser auditáveis separadamente internamente, mas consolidadas em uma única recomendação pública.

Essa separação é essencial para interpretar Itaú e BB Seguridade sem forçar o resultado desejado.

---

## 3. Fotografia atual do funil

No snapshot atual:

| Etapa | Quantidade |
|---|---:|
| Documentos STOCK cadastrados | 371 |
| Ativos após flags operacionais | 346 |
| Classes alternativas removidas | 59 |
| Universo efetivo antes dos cortes | 287 |
| Descartados antes do score | 84 |
| Ativos completamente pontuados | 203 |
| Elegíveis ao gate Defensivo | 52 |
| Score Defensivo bruto ≥ 70 | 4 |
| Selecionados no draft público | 30, sendo 10 por perfil |
| `BUY` no draft | 10 |
| `BUY` no perfil Defensivo | 4 |

Conclusão sobre o limite de 30: os demais ativos não deixam de ser analisados. Os 203 sobreviventes são pontuados; o draft escolhe 10 por perfil. Também foi confirmado que somente quatro dos 203 tinham score Defensivo bruto ≥70 antes da seleção. Portanto, o limite de 30 não estava escondendo outros `BUY` defensivos no algoritmo atual.

Isso, porém, não prova que a calibração esteja correta. Prova apenas que o número quatro é consequência das regras atuais, e não de um truncamento prematuro.

---

## 4. Resultado principal

O sistema está operacionalmente consistente, mas o modelo STOCK não está semanticamente bem calibrado para bancos e seguradoras.

Foram encontrados dois problemas distintos:

1. **Erro objetivo de aplicabilidade de dados.** Bancos com ROE conhecido perdem 15 pontos porque `netMargin` está ausente, embora margem líquida genérica não seja uma métrica comparável adequada para esse setor. O próprio motor já reconhece essa inaplicabilidade em outros blocos, mas não na confiança.
2. **Mistura entre perfil do ativo e vaga do portfólio.** Mesmo quando `ITUB4` chega a 71 no Defensivo no cenário corrigido, o cap de três ativos do macrosetor financeiro o bloqueia nessa fase. Depois, o algoritmo o atribui ao Arrojado com score 55/WAIT. O perfil exibido passa a refletir a vaga disponível, não apenas a adequação econômica do ativo.

Também existe um terceiro grupo de hipóteses que precisa de shadow mode, e não de correção imediata:

- força da penalidade direta de confiança;
- valuation genérico aplicado a instituições financeiras;
- desconto fixo por controle estatal;
- pesos e thresholds setoriais.

---

## 5. Caso ITUB4

### 5.1 Dados usados pelo motor

| Métrica | Snapshot |
|---|---:|
| Preço | R$ 41,96 |
| Preço justo genérico | R$ 37,17 |
| P/L | 9,96 |
| P/VP | 2,32 |
| ROE | 23,24% |
| Dividend yield | 8,26% |
| Payout | 82,27% |
| Beta | 1,12 |
| Volatilidade | 24,02% |
| Liquidez média diária | R$ 1,107 bi |
| Qualidade / Valuation / Risco estrutural | 90 / 75 / 80 |
| Confiança atual | 85 |

### 5.2 Waterfall Defensivo atual

| Fator | Pontos |
|---|---:|
| Base de setor defensivo | +40 |
| Large cap | +10 |
| DY ≥ 8% | +16 |
| ROE ≥ 20% | +15 |
| P/VP > 2 | -5 |
| Payout saudável | +5 |
| Preço 11% acima do preço justo genérico | -10 |
| Dado de rentabilidade ausente | -15 |
| **Score final** | **56** |

Antes da penalidade de dados, o score é 71. O desconto de 15 pontos ocorre exclusivamente porque `netMargin` está marcado como ausente. O ROE não está ausente e é alto.

### 5.3 Evidência econômica externa

No resultado oficial do 1T26, o Itaú reportou resultado recorrente gerencial de R$ 12,282 bilhões, ROE de 24,8%, carteira de crédito de R$ 1,483 trilhão e inadimplência acima de 90 dias de 1,9%. O relatório também apresenta capital principal, índice de Basileia, liquidez e eficiência — dimensões que o modelo atual não armazena nem pontua. Fonte: [Itaú Unibanco — resultados 1T26](https://www.itau.com.br/download-file/v2/d/42787847-4cf6-4461-94a5-40ed237dca33/401df7db-e169-2b88-ba6c-7246b8f426c3?origin=2).

O Banco Central avalia instituições financeiras por capital, liquidez e exposição a riscos, e o arcabouço prudencial internacional também enfatiza capital, qualidade dos ativos, gestão, rentabilidade, liquidez e sensibilidade a risco. Fontes: [Banco Central — estabilidade financeira](https://www.bcb.gov.br/estabilidadefinanceira) e [BIS — supervisory framework](https://www.bis.org/basel_consolidated_guidelines/chapter/SCA/60.htm).

### 5.4 Diagnóstico

Há evidência forte de falso negativo parcial:

- o motor reconhece ROE, escala, liquidez e dividendos;
- desconta valuation, o que é coerente com `BUY agora`;
- mas retira 15 pontos por uma métrica genérica inaplicável ao banco;
- e não substitui essa métrica por qualidade de crédito, capital, eficiência ou recorrência.

No cenário isolado em que somente a aplicabilidade da margem é corrigida, sem alterar threshold, valuation, ROE, DY ou governança, `ITUB4` passa de 56 para 71.

Isso não significa que o sistema deva publicar `ITUB4 = BUY` imediatamente. No draft completo, o macrosetor financeiro já tem três vagas Defensivas ocupadas por `ABCB4`, `WIZC3` e `ITSA4`. O Itaú é bloqueado pelo cap e posteriormente selecionado como Arrojado com 55/WAIT. Portanto, sua ausência pública tem duas causas: penalidade de dado inadequada e regra de alocação por setor.

### 5.5 Veredito de auditoria

`ITUB4 = 56` não é uma representação confiável da evidência disponível. A parte de valuation pode continuar justificando cautela, mas a perda por margem ausente é tecnicamente indevida para um banco. O perfil Arrojado gerado depois do bloqueio setorial também não é uma descrição econômica convincente do ativo.

---

## 6. Caso BBSE3

### 6.1 Dados usados pelo motor

| Métrica | Snapshot |
|---|---:|
| Preço | R$ 41,12 |
| Preço justo genérico | R$ 38,31 |
| Graham / Bazin | R$ 26,33 / R$ 46,30 |
| P/L | 8,68 |
| P/VP | 6,32 |
| ROE | 72,72% |
| Dividend yield | 11,36% |
| Payout | 98,60% |
| Beta | 0,49 |
| Volatilidade | 21,36% |
| Qualidade / Valuation / Risco estrutural | 50 / 60 / 80 |
| Confiança atual | 60 |

### 6.2 Waterfall Defensivo atual

| Fator | Pontos |
|---|---:|
| Base de setor defensivo | +40 |
| Large cap | +10 |
| DY ≥ 10% | +22 |
| ROE ≥ 20% | +15 |
| P/VP > 3 | -10 |
| Beta < 0,7 | +5 |
| Controle estatal | -8 |
| Crescimento ausente | -25 |
| Rentabilidade ausente | -15 |
| **Score final** | **34** |

O score econômico anterior às deduções de confiança soma 74. O resultado final perde 40 pontos porque `revenueGrowth` e `netMargin` estão marcados como ausentes.

### 6.3 Evidência econômica externa

A BB Seguridade reportou lucro líquido gerencial consolidado de aproximadamente R$ 2,220 bilhões no 1T26, alta de 11,2% sobre o ano anterior. A análise oficial também apresenta índice combinado de 67,1%, sinistralidade de 23,9%, crescimento das contribuições de previdência e fluxo líquido positivo — métricas operacionais próprias do negócio de seguros e previdência. Fontes: [BB Seguridade — análise de desempenho 1T26](https://api.mziq.com/mzfilemanager/v2/d/d4ee6df5-1dd8-4fb5-b518-e05397c304e4/35616430-abec-fe23-70bd-2e9b2d3f5320?origin=2) e [release de resultados 1T26](https://api.mziq.com/mzfilemanager/v2/d/d4ee6df5-1dd8-4fb5-b518-e05397c304e4/4aef6c8c-a991-c085-1ac8-67499d7ed8ef?origin=2).

A SUSEP acompanha receitas, provisões, resseguro, sinistralidade, despesas e resultados das supervisionadas. Esses dados setoriais não estão representados no schema atual de `MarketAsset`. Fonte: [SUSEP — Sistema de Estatísticas](https://www2.susep.gov.br/menuestatistica/ses/principal.aspx).

### 6.4 Contrafactuais

| Cenário | Score D | Interpretação |
|---|---:|---|
| Produção | 34 | perde 25 por crescimento e 15 por margem |
| Corrigir somente margem como N/A | 49 | crescimento continua realmente não resolvido |
| Manter dados atuais, mas usar apenas teto de confiança | 74 | sensibilidade de desenho; não valida a qualidade dos dados |

O cenário 74 não é recomendação. Ele demonstra apenas que a forma de aplicar confiança domina o resultado. Não se deve transformar `revenueGrowth=0/missing` em crescimento positivo com base em um trimestre de lucro. Primeiro é necessário definir qual medida de crescimento é economicamente correta para uma holding de seguros e construir histórico suficiente.

### 6.5 Valuation e governança

Dois descontos adicionais exigem calibração própria:

- P/VP de 6,32 recebe -10. Em uma holding asset-light com ROE muito elevado, P/VP isolado não tem a mesma interpretação de uma companhia industrial. Isso não torna o ativo barato; torna o múltiplo insuficiente sem ROE sustentável, custo de capital e recorrência.
- O desconto de -8 por controle estatal trata controle indireto via Banco do Brasil como equivalente a controle estatal direto. O risco existe, mas a magnitude fixa ainda não possui validação empírica no sistema.

### 6.6 Veredito de auditoria

Não há base para concluir que `BBSE3` deve ser `BUY`, mas há base suficiente para concluir que o score 34 não é confiável. O modelo está usando ausência de campos genéricos como substituto para risco econômico e não enxerga os indicadores próprios do negócio. Após corrigir somente o erro inequívoco de margem, BBSE3 ainda fica em 49; portanto, a decisão final depende de dados setoriais, valuation e governança — não de afrouxar limites.

---

## 7. Controles negativos e pares

Os pares mostram por que a correção não pode ser uma liberação geral de financeiros.

| Ativo | Score D atual | Apenas margem N/A corrigida | Leitura |
|---|---:|---:|---|
| ABCB4 | 69 | 84 | cruza o threshold, mas ainda precisa de métricas bancárias de capital/crédito |
| ITUB4 | 56 | 71 | falso negativo material por aplicabilidade |
| BBDC4 | 53 | 68 | melhora, mas permanece WAIT |
| BBAS3 | 21 | 36 | permanece muito abaixo; correção não apaga ROE/DY/tendência/governança |
| BBSE3 | 34 | 49 | continua abaixo enquanto crescimento setorial não é resolvido |
| CXSE3 | 10 | 20 | continua penalizada por valuation; não é promovida artificialmente |
| PSSA3 | 60 | 60 | confiança 100 e qualidade 100, mas WAIT por preço 27% acima da âncora e P/VP |
| ITSA4 | 76 | 76 | não perde confiança porque uma margem de 203,91% aparece como “presente” |

`PSSA3` é um controle especialmente útil: o modelo reconhece a qualidade estrutural, mas mantém WAIT por valuation. Isso é compatível com buy and hold disciplinado.

`ITSA4` revela a inconsistência oposta. Uma margem economicamente anômala, mas presente, evita a perda de confiança; bancos com margem ausente perdem 15. O sistema está premiando a forma como o provedor preenche o campo, não a qualidade real do dado.

No cenário completo de correção de margem para financeiros:

- `BUY` total sobe de 10 para 13;
- `BUY` Defensivo sobe de 4 para 5;
- `ABCB4` entra no Defensivo com 84;
- `ITSA4` cai de 76 para 71 por se tornar o terceiro financeiro e receber -5 de concentração;
- `ITUB4`, embora tenha D=71, é barrado pelo cap setorial e termina no Arrojado com 55/WAIT;
- `PINE4` e `BMGB4` passam a 71 no Moderado.

Esse resultado prova que a correção ingênua de um único campo já altera bastante a composição e pode promover bancos que ainda não foram validados por indicadores bancários. Logo, a correção de aplicabilidade é necessária, mas deve entrar junto com guardas setoriais ou inicialmente em shadow mode.

---

## 8. Métricas ausentes no modelo financeiro

### 8.1 Bancos

O modelo atual não persiste nem pontua:

- ROE recorrente e sua estabilidade em vários anos;
- inadimplência acima de 90 dias e formação de NPL;
- custo do crédito e cobertura;
- índice de eficiência;
- capital principal/CET1 e índice de Basileia;
- liquidez regulatória;
- crescimento saudável da carteira e depósitos;
- concentração de crédito;
- qualidade do lucro e capacidade sustentável de distribuição.

`netMargin`, dívida/EBITDA e crescimento genérico de receita não substituem essas dimensões.

### 8.2 Seguradoras e holdings de seguros

O modelo atual não persiste nem pontua:

- lucro recorrente e crescimento normalizado em vários anos;
- índice combinado e sinistralidade;
- solvência e adequação de capital;
- evolução de prêmios, contribuições e reservas;
- resultado financeiro versus operacional;
- remessas de caixa das controladas e sustentabilidade do payout;
- concentração de distribuição e dependência do controlador/parceiro bancário.

Uma holding de seguros também não deve ser automaticamente tratada como seguradora operacional. Algumas métricas, como índice combinado, aplicam-se às controladas específicas e precisam ser consolidadas com critério.

---

## 9. Problema de arquitetura do score

Hoje o score de perfil mistura quatro funções:

1. adequação do ativo ao perfil;
2. qualidade/durabilidade;
3. oportunidade de entrada;
4. construção diversificada do portfólio.

Isso produz efeitos difíceis de explicar. `ITUB4` pode ter seu maior score no Defensivo, ser bloqueado por concentração e acabar rotulado Arrojado. A penalidade de concentração também pode transformar um `BUY` individual em `WAIT`, embora nada tenha mudado na empresa ou no preço — apenas sua posição na lista.

O cap setorial é legítimo para montar carteira. Ele não deve, contudo, redefinir a natureza do ativo nem a convicção individual de compra.

Há ainda divergência documental: a descrição arquitetural menciona limite GOLD Defensivo de quatro ativos por setor, mas o código executado usa três por macrosetor. O valor produtivo observado é três.

---

## 10. Classificação dos achados

| ID | Tipo | Severidade | Achado | Ação correta |
|---|---|---:|---|---|
| C-01 | Correção objetiva | Alta | margem N/A de bancos/seguradoras reduz confiança | criar matriz de aplicabilidade; N/A não é missing |
| C-02 | Dados | Alta | schema não contém indicadores financeiros setoriais | construir coleta e histórico por arquétipo |
| C-03 | Produto/modelagem | Alta | vaga do draft redefine perfil do ativo | separar perfil/score individual da montagem da carteira |
| C-04 | Explicabilidade | Alta | admin não persiste os três scores e o motivo completo de bloqueio | persistir scores D/M/B e reason codes do draft |
| C-05 | Calibração | Média/Alta | confiança é subtraída diretamente e também possui teto | testar controle versus cap-only em shadow; não mudar por intuição |
| C-06 | Valuation | Alta | Graham/Bazin/P/VP genéricos dominam financeiros | criar valuation por arquétipo e comparar em shadow |
| C-07 | Governança | Média | desconto estatal fixo não distingue controle direto/indireto | manter metadado temporal e validar efeito incremental |
| C-08 | Documentação | Média | cap Defensivo documentado como 4, executado como 3 | alinhar contrato e testes após decisão de produto |

---

## 11. Proposta de evolução sem afrouxamento

### Fase A — correção da ontologia de dados

Criar, por arquétipo, uma matriz explícita com três estados:

- `REQUIRED`: deveria existir; ausência reduz confiança;
- `OPTIONAL`: ajuda, mas ausência não invalida;
- `NOT_APPLICABLE`: não participa nem reduz confiança.

Arquétipos mínimos: empresa operacional, banco, seguradora operacional, holding financeira, utility, cíclica e holding não financeira.

Regras de segurança:

- zero conhecido não pode ser confundido com ausente;
- N/A não pode ser armazenado como zero econômico;
- dado presente, mas anômalo, não pode ganhar confiança automaticamente;
- toda métrica precisa de fonte, período de referência, data de coleta e qualidade.

### Fase B — modelos setoriais em shadow

Manter o algoritmo atual como controle e calcular candidatos sem publicar:

- `BANK_V1`: rentabilidade recorrente, qualidade de crédito, capital, eficiência, liquidez, crescimento e valuation bancário;
- `INSURANCE_V1`: resultado recorrente, subscrição/sinistralidade, solvência, crescimento, distribuição e valuation;
- `FIN_HOLDING_V1`: qualidade e fluxo das participações, desconto/soma das partes, governança e capacidade de remessa.

Nenhum candidato deve ser aprovado porque gera mais BUYs. Ele deve demonstrar melhor coerência econômica, cobertura, estabilidade e explicabilidade.

### Fase C — separar os componentes internos sem fragmentar o ranking público

Estrutura interna recomendada:

1. `durabilityScore`: qualidade para possuir no longo prazo;
2. `entryScore`: atratividade de entrada hoje;
3. `riskSuitability`: perfil intrínseco mais adequado;
4. `portfolioSelection`: aplicação posterior de concentração e diversificação.

O `BUY` pode continuar exigindo score ≥70, mas deve depender de um gate mínimo de durabilidade mais atratividade de entrada. A penalidade de concentração deve afetar a seleção/peso da carteira, não reescrever o score individual ou o perfil econômico.

**Contrato público decidido:** os componentes acima não formarão listas concorrentes. O usuário receberá um único `score`, uma única `action` e um único Top 10 coeso por perfil. A decomposição ficará disponível somente na auditoria administrativa e na validação shadow.

### Fase D — validação prospectiva

O histórico fundamental disponível ainda é curto e versões antigas não possuem identificação completa do algoritmo. Portanto, um backtest retrospectivo agora correria risco de usar informação que não estava disponível na data.

O shadow deve registrar, por versão:

- inputs point-in-time e sua origem;
- scores individualizados;
- fatores e clamps;
- perfil antes do draft;
- motivo de entrada/bloqueio;
- retorno total futuro, drawdown e estabilidade;
- mudança de classificação por atualização de dado versus mudança real de fundamento.

Critérios de aceitação:

- cobertura alta das métricas obrigatórias;
- nenhuma promoção por simples troca de `missing` para zero/presente;
- monotonicidade econômica: melhora de capital, qualidade de crédito ou recorrência não pode piorar score sem outro fator explícito;
- estabilidade suficiente para buy and hold;
- poder explicativo incremental sobre o controle;
- ausência de meta de quantidade de BUY.

---

## 12. Decisões propostas para consenso

### Decisão 1 — quantidade de BUY

**Proposta:** manter sem cota mínima e preservar threshold 70 enquanto calibramos.  
**Motivo:** obrigar 10 BUY confundiria ranking relativo com recomendação absoluta e promoveria ativos fracos em mercados caros.

### Decisão 2 — aplicabilidade setorial

**Proposta:** considerar confirmado que margem líquida genérica não deve reduzir confiança de bancos e de holdings/seguradoras quando for N/A; implementar somente com matriz por arquétipo e testes.  
**Motivo:** é correção semântica, não relaxamento.

### Decisão 3 — bancos e seguros

**Proposta:** criar modelos setoriais em shadow antes de mudar o ranking publicado.  
**Motivo:** retirar a penalidade sem adicionar capital, crédito, solvência e recorrência promoveria alguns ativos com evidência ainda incompleta.

### Decisão 4 — perfil versus carteira

**Proposta:** separar o perfil/score individual da diversificação do portfólio.  
**Motivo:** um banco defensivo não deve virar Arrojado porque a terceira vaga financeira foi ocupada.

### Decisão 5 — confiança

**Proposta:** manter o modelo atual como controle e testar `dedução + teto`, `somente teto` e uma função graduada por criticidade da métrica.  
**Motivo:** BBSE3 varia de 34 a 74 somente pela mecânica de confiança; escolher por intuição geraria overfitting.

### Decisão 6 — comunicação ao usuário

**Decisão aprovada:** entregar um único Top 10 coeso por perfil, com um score e uma ação por ativo. Qualidade, entrada e risco permanecem componentes internos do cálculo e da auditoria, sem virar listas separadas. O texto explicativo do `WAIT` deve indicar o fator dominante — preço, dados, risco ou concentração — sem criar uma segunda recomendação.  
**Motivo:** preservar uma resposta simples e acionável para o usuário, sem perder rigor e rastreabilidade no backend/admin.

---

## 13. Consenso técnico preliminar

1. O limite de 30 não é a causa dos quatro BUY Defensivos.
2. Quatro BUY não significa que só existam quatro boas empresas para buy and hold.
3. `ITUB4` contém um falso negativo verificável de 15 pontos por margem N/A; seu score individual corrigido chega a 71, mas o cap setorial ainda o retira do Defensivo.
4. `BBSE3` está subavaliada pelo score por 40 pontos de missingness, mas somente 15 são hoje classificáveis como erro inequívoco. Os 25 de crescimento exigem uma métrica setorial e histórico apropriados.
5. Não devemos promover automaticamente ITUB4, BBSE3 ou qualquer par. Devemos corrigir a linguagem dos dados, construir indicadores setoriais e validar em paralelo.
6. A melhor evolução não é aumentar o número de BUY; é tornar cada BUY e cada WAIT economicamente explicáveis.
7. O resultado público continuará sendo um único Top 10 por perfil; os eixos de qualidade, entrada e risco não serão expostos como rankings independentes.

---

## 14. Próxima fase recomendada

Após aprovação das decisões acima:

1. especificar a matriz `REQUIRED / OPTIONAL / NOT_APPLICABLE` para STOCK;
2. definir o contrato de dados para `BANK_V1`, `INSURANCE_V1` e `FIN_HOLDING_V1`;
3. definir score de durabilidade, entrada e suitability sem alterar produção;
4. implementar cálculo shadow versionado;
5. gerar relatório comparativo do universo completo, com foco inicial em bancos e seguradoras;
6. só então decidir quais mudanças merecem promoção para produção.

---

## 15. Implementação inicial aprovada — shadow V1

Após a decisão de manter um único Top 10 público, foi criado o contrato `STOCK_BH_SHADOW_V1`, ainda sem integração com o ranking de produção.

Entregas realizadas:

- arquétipos `OPERATIONAL`, `BANK`, `INSURER`, `INSURANCE_BROKER` e `FINANCIAL_HOLDING`;
- matriz `REQUIRED / OPTIONAL / NOT_APPLICABLE`;
- schema persistível para métricas bancárias, securitárias e de holdings, mantendo ausências como `null`;
- validação estrita com data-base, fonte e documento de origem obrigatórios;
- compositor interno de durabilidade, entrada e resiliência que devolve somente um score e uma ação;
- gerador de um único Top 10 público por perfil, com decomposição reservada ao admin;
- bloqueio de candidatos setoriais sem cobertura mínima;
- auditoria read-only de prontidão do universo;
- testes de aplicabilidade, monotonicidade, unicidade, ordenação, threshold e ausência de quota de BUY.

Fotografia de prontidão em 20/07/2026 UTC:

| Arquétipo | Ativos ativos | Prontos para shadow setorial | Cobertura média dos requisitos |
|---|---:|---:|---:|
| Operacionais | 319 | 302 | 98,9% |
| Bancos | 20 | 0 | 43,0% |
| Seguradoras operacionais | 3 | 0 | 45,0% |
| Holdings financeiras | 4 | 0 | 42,0% |

O inventário posterior identificou `WIZC3` como corretora/distribuidora de seguros, não seguradora operacional. Ela foi removida do contrato de solvência/índice combinado e passou ao arquétipo `INSURANCE_BROKER`, evitando uma nova penalidade por métrica inaplicável.

Os 27 financeiros não estão prontos porque ainda faltam, de forma estruturada e versionada:

- bancos: ROE recorrente, crescimento de lucro, NPL 90, capital e eficiência;
- seguradoras: crescimento recorrente, solvência e índice combinado;
- holdings: crescimento recorrente, cobertura de remessas, adequação de capital e tipo de controle;
- todos: data-base, fonte e documento de origem.

**Decisão de segurança:** o shadow não preencherá essas lacunas com zero, proxy genérica ou dado manual sem proveniência. Até a ingestão setorial estar pronta, o ranking publicado permanece inalterado.

---

## 16. Atualização da cobertura setorial oficial

A lacuna descrita na seção anterior foi fechada no namespace shadow, sem sobrescrever os fundamentos genéricos e sem recalcular/publicar `MarketAnalysis`.

Fotografia validada em 20/07/2026 UTC:

| Arquétipo | Documentos ativos | Prontos | Cobertura |
|---|---:|---:|---:|
| Bancos | 20 | 20 | 100% |
| Seguradoras operacionais | 2 | 2 | 100% |
| Holding/distribuidora de seguros | 2 | 2 | 100% |
| Holding diversificada | 2 | 2 | 100% |
| Corretora/distribuidora de seguros | 1 | 1 | 100% |
| **Financeiros — total** | **27** | **27** | **100%** |

Fontes primárias utilizadas:

- bancos: BCB IFData 1T26, com reconciliação e guardas de plausibilidade antes da persistência;
- `PSSA3`: release oficial Porto 1T26;
- `IRBR3`: resultado oficial IRB(Re) 1T26;
- `BBSE3` e `CXSE3`: releases oficiais de resultados 1T26;
- `ITSA3/ITSA4`: resultado oficial Itaúsa 1T26;
- `WIZC3`: release oficial Wiz 1T26;
- SUSEP: referência regulatória para dados e conceitos de solvência do setor segurador.

Foram persistidas somente `stockArchetype` e `sectorMetrics`, com `asOf`, fonte, documento e versão de metodologia. O ranking publicado permaneceu inalterado.

---

## 17. Auditoria do universo completo — execução shadow

O auditor read-only reprocessou todo o universo STOCK disponível:

| Etapa | Quantidade |
|---|---:|
| Documentos ativos | 346 |
| Emissores/classes deduplicados efetivamente analisados | 287 |
| Descartados antes do score | 84 |
| — liquidez abaixo de R$ 200 mil/dia | 83 |
| — preço de centavos | 1 |
| Totalmente pontuados | 203 |
| Prontos para a calibração | 202 |
| Excluídos por cobertura obrigatória | 1 (`BRAP4`) |

Portanto, o limite visual de 30 nunca foi o universo analisado. Os 30 são a saída final de três carteiras de dez; 287 ativos foram avaliados, e os 84 descartes possuem motivo auditável.

---

## 18. Shadow V1 rejeitado pela própria auditoria

A primeira composição aplicou diretamente os eixos estruturais de 0–100. Ela gerou 30 BUY em 30 posições. A causa não foi melhora real dos fundamentos, mas incompatibilidade de escala: `QUALITY / VALUATION / RISK` possuem muitos valores próximos de 80–100, enquanto o threshold público de 70 foi calibrado sobre os scores históricos de perfil.

**Decisão:** rejeitar V1 para ranking. O teste demonstrou por que não se deve substituir o score atual por uma média intuitiva dos novos eixos.

---

## 19. Shadow V2 — composição ancorada

A V2 usa:

- 80% do score de perfil recalculado com a matriz de aplicabilidade;
- 20% do score composto de durabilidade, entrada e resiliência;
- threshold global de 70, sem quota de BUY;
- confiança como teto;
- draft competitivo na ordem `DEFENSIVE → MODERATE → BOLD`;
- um único perfil por ticker;
- quatro vagas por macro-setor no GOLD Defensivo, conforme a regra documentada;
- limites vigentes nos demais perfis; em STOCK, concentração atua na seleção e não reescreve score/ação pós-draft.

Integridade obtida: **30 posições, 30 tickers únicos, 10 por perfil, nenhuma duplicidade**.

### Top 10 Defensivo — shadow V2

| # | Ticker | Score | Ação |
|---:|---|---:|---|
| 1 | CMIG4 | 89 | BUY |
| 2 | ABCB4 | 81 | BUY |
| 3 | WIZC3 | 77 | BUY |
| 4 | TAEE11 | 76 | BUY |
| 5 | ITSA4 | 74 | BUY |
| 6 | INTB3 | 72 | BUY |
| 7 | ITUB4 | 72 | BUY |
| 8 | CPFE3 | 69 | WAIT |
| 9 | VLID3 | 63 | WAIT |
| 10 | VULC3 | 61 | WAIT |

### Top 10 Moderado — shadow V2

| # | Ticker | Score | Ação |
|---:|---|---:|---|
| 1 | MDNE3 | 95 | BUY |
| 2 | JHSF3 | 83 | BUY |
| 3 | POMO4 | 69 | WAIT |
| 4 | AZZA3 | 68 | WAIT |
| 5 | BMGB4 | 68 | WAIT |
| 6 | EUCA4 | 66 | WAIT |
| 7 | RIAA3 | 65 | WAIT |
| 8 | PETR4 | 63 | WAIT |
| 9 | FIQE3 | 63 | WAIT |
| 10 | BRSR6 | 61 | WAIT |

### Top 10 Arrojado — shadow V2

| # | Ticker | Score | Ação |
|---:|---|---:|---|
| 1 | VTRU3 | 91 | BUY |
| 2 | RECV3 | 90 | BUY |
| 3 | EZTC3 | 84 | BUY |
| 4 | CYRE3 | 79 | BUY |
| 5 | DIRR3 | 75 | BUY |
| 6 | GMAT3 | 69 | WAIT |
| 7 | CSED3 | 67 | WAIT |
| 8 | SHUL4 | 59 | WAIT |
| 9 | MILS3 | 56 | WAIT |
| 10 | CSUD3 | 55 | WAIT |

Após a decisão de fazer a concentração atuar somente na seleção — sem reduzir o score nem reescrever `BUY/WAIT` — o total passou de 8 BUY no relatório publicado de 14/07/2026 para 14 no shadow: 7 Defensivos, 2 Moderados e 5 Arrojados. Não existe quota: os demais 16 continuam `WAIT`.

---

## 20. Diagnóstico dos ativos de referência

### ITUB4

- score Defensivo aplicável antes dos eixos: 71;
- eixos: durabilidade 74, entrada 73, resiliência 76;
- score coeso final: 72 (`BUY`);
- foi selecionado como o quarto financeiro no Defensivo;
- a concentração não altera mais o fundamento nem a ação;
- posição final: 7.

Conclusão: o falso negativo de dados foi corrigido e ITUB4 passa a `BUY`. A carteira permanece protegida pelo teto de quatro financeiros; BBSE3, o quinto candidato, continua fora.

### BBSE3

- score Defensivo aplicável antes dos eixos: 74;
- eixos: durabilidade 47, entrada 59, resiliência 61;
- score coeso: 70 (`BUY`) antes do draft;
- ficou fora por ser o quinto candidato do macro-setor financeiro, acima do teto defensivo de quatro.

Conclusão: BBSE3 deixa de ser um falso `34`, mas não recebe promoção automática. O crescimento recorrente de 11,2% e o valuation ajudam; crescimento de receita de distribuição de 1,4%, concentração e adequação de capital conservadora limitam os eixos. Sua ausência final é uma decisão de portfólio, não falta de análise.

### BBAS3

- score Defensivo aplicável: 36;
- eixos: durabilidade 31, entrada 79, resiliência 55;
- não atingiu a zona competitiva do Top 10.

Conclusão: o Banco do Brasil está barato, mas preço baixo não compensou a deterioração/volatilidade recente de lucro e os riscos de crédito/governança observados. Ele ficou fora por fundamentos setoriais e score, não por missingness.

### PSSA3

- eixos setoriais fortes: durabilidade 74, entrada 64, resiliência 68;
- permaneceu fora do draft V2.

Conclusão: a Porto continua sendo o principal caso de sensibilidade metodológica. Remover receita genérica e substituí-la por prêmio/recorrência é semanticamente correto, mas o blend ancorado em 80% ainda pode subponderar a evidência setorial. Não deve ser promovida por reputação, porém este ponto precisa de validação prospectiva antes de produção.

---

## 21. Consenso técnico atualizado e pendências

1. A matriz de aplicabilidade corrige falsos negativos reais sem transformar ausência em fundamento positivo.
2. Dados setoriais oficiais diferenciam melhor bancos baratos de bancos duráveis; `ITUB4` melhora, `BBAS3` não.
3. O blend 80/20 evita a inflação observada na V1 e preserva a escala do threshold 70.
4. O teto Defensivo de 4 por macro-setor está alinhado à especificação; o default atual do core usa 3 e deve ser corrigido somente se a V2 for promovida.
5. **Decisão aprovada:** em STOCK, concentração limita a seleção do Top 10, mas não reduz o score fundamental nem converte `BUY` em `WAIT` depois do draft.
6. Para o usuário haverá apenas uma lista, um score e uma ação; o motivo de bloqueio por cap permanece na auditoria admin.
7. Também falta observar estabilidade em múltiplas rodadas point-in-time, especialmente `PSSA3`, incorporadoras e casos próximos de 70.

**Estado:** calibração técnica concluída em shadow; produção e ranking público inalterados.

---

## 22. Caso PETR4 — gigante, barata e ainda `WAIT`

O novo draft shadow selecionou `PETR4` em 8º no perfil Moderado, com score 63 e ação `WAIT`. Ela não foi ignorada nem bloqueada por concentração.

### Fotografia dos fundamentos utilizados

| Indicador | Valor |
|---|---:|
| Preço | R$ 40,90 |
| Preço justo do motor | R$ 49,93 |
| Upside estimado | 22,1% |
| P/L | 4,9 |
| P/VP | 1,18 |
| ROE | 24,17% |
| Margem líquida | 21,69% |
| Dividend yield 12m | 7,26% |
| Crescimento de receita | -2,88% |
| Dívida/patrimônio | 0,73 |
| Beta | 0,53 |
| Estrutural — qualidade / valuation / risco | 75 / 100 / 80 |

### Como o score Moderado chegou a 57 antes do blend

- base de large cap: +40;
- ROE excelente: +15;
- upside acima de 20%: +10;
- setor cíclico com Selic a 14,25%: -4;
- controle estatal: -4;
- total: 57;
- eixos V2 Moderados: 85;
- blend `80% × 57 + 20% × 85`: 63 (`WAIT`).

O Defensivo nem chega a competir: o gate atual barra **todo** macro-setor `COMMODITIES`, independentemente de tamanho, beta, dívida, DY ou valuation. Isso evita confundir lucro de pico de ciclo com segurança, mas é uma regra absoluta.

### Evidência oficial recente

No 1T26, a Petrobras informou lucro líquido de R$ 32,7 bilhões, EBITDA ajustado recorrente de R$ 61,7 bilhões e recordes de produção. O lucro ajustado por eventos exclusivos foi R$ 23,8 bilhões, queda de 7,2% ante o 4T25. A dívida bruta ficou em US$ 71,2 bilhões, dentro do limite do plano, e a alavancagem líquida/EBITDA ajustado foi 1,43x. Também foram declarados R$ 9,03 bilhões, ou R$ 0,70097272 por ação, relativos ao 1T26.

Esses números sustentam que a Petrobras é lucrativa, eficiente, de grande escala e financeiramente administrável. Porém, não removem três riscos estruturais:

1. lucro e dividendos dependem do petróleo, câmbio, produção e capex;
2. P/L baixo pode refletir lucro cíclico elevado e não necessariamente barganha permanente;
3. o grupo de controle estatal detém 36,26% do capital total, tornando política de preços, investimentos e distribuição parcialmente discricionária.

### Conclusão de calibração

PETR4 possui fundamento para ser **candidata legítima de buy and hold**, especialmente no perfil Moderado. O `WAIT 63` não prova que a empresa seja ruim; mostra que o modelo exige mais margem antes de recomendar compra sob ciclo e governança estatal.

Também há uma lacuna real: `OPERATIONAL` não é suficiente para petróleo. A próxima calibração setorial deve criar `OIL_GAS / COMMODITY`, usando no mínimo:

- lucro e margem normalizados em vários pontos do ciclo;
- Brent/câmbio de equilíbrio e sensibilidade;
- custo de extração e breakeven;
- reposição de reservas e vida útil;
- produção, capex e retorno incremental;
- dívida líquida/EBITDA normalizada;
- política ordinária versus dividendos extraordinários;
- controle estatal e histórico de alocação de capital.

Até essa camada existir, não é prudente promover PETR4 para `BUY` apenas por P/L, DY ou reputação. Também não é correto tratá-la como empresa sem fundamento: ela permanece no Top 10 Moderado e próxima do threshold.

---

## 23. Arquétipo `OIL_GAS_PRODUCER` — contrato e evidência oficial

O universo com setor genérico `Petróleo` possui nove tickers, mas apenas cinco representam produtoras comparáveis: `PETR3`, `PETR4`, `PRIO3`, `RECV3` e `BRAV3`. `CSAN3`, `RAIZ4`, `UGPA3` e `VBBR3` possuem modelos econômicos distintos e permanecem fora deste arquétipo.

O contrato setorial usa como núcleo obrigatório:

- crescimento anual da produção atribuível ao emissor;
- lifting cost em US$/boe, com a base declarada;
- margem EBITDA e sua base (`reported`, `adjusted` ou `adjusted ex-IFRS 16`);
- dívida líquida/EBITDA;
- tipo de controle;
- proveniência, data-base e versão metodológica.

Fluxo de caixa livre, vida de reservas 1P e reposição de reservas permanecem opcionais. Reservas 2P não foram convertidas artificialmente em vida de reservas 1P.

### Snapshot oficial utilizado

| Emissor | Produção YoY | Lifting cost | Margem EBITDA | DL/EBITDA | FCF/receita | Controle |
|---|---:|---:|---:|---:|---:|---|
| Petrobras | +16,38% | US$ 6,40/boe | 49,71% | 1,43x | 16,51% | Estatal direto |
| PRIO | +42,0% | US$ 9,40/boe | 76,0% | 2,00x | n/d | Privado |
| Brava | -1,0% | US$ 14,20/boe | 51,9% | 1,84x | 13,09% | Privado |
| PetroReconcavo | -11,0% | US$ 15,82/boe | 45,3% | 1,04x | 11,7% | Privado |

Fontes primárias: [Petrobras — resultado 1T26](https://agencia.petrobras.com.br/w/negocio/petrobras-registra-lucro-l%C3%ADquido-de-r-32-7-bilh%C3%B5es-no-primeiro-trimestre-de-2026), [Petrobras — produção](https://www.investidorpetrobras.com.br/visao-geral/indicadores/producao-e-comercializacao-3/), [Petrobras — alavancagem](https://www.investidorpetrobras.com.br/visao-geral/indicadores/divida-liquida-ebitda-ajustado/), [Petrobras — reservas provadas](https://www.investidorpetrobras.com.br/visao-geral/indicadores/reservas-provadas/), [PRIO — release 1T26](https://api.mziq.com/mzfilemanager/v2/d/cecb3d3e-6bd6-4edd-b9b3-3cacde780cac/e1035b51-e64e-dd53-163e-6a57c2d49930?origin=2), [Brava — release 1T26](https://api.mziq.com/mzfilemanager/v2/d/55b913af-cd4c-48d5-bc19-48c63916b8a5/98d83b7d-a1fb-849d-4262-1758f53a8892?origin=2) e [PetroReconcavo — release 1T26/CVM](https://www.rad.cvm.gov.br/ENETCONSULTA/frmDownloadDocumento.aspx?CodigoInstituicao=1&Tela=99&descTipo=IPE&numProtocolo=1518205&numSequencia=1042911&numVersao=1).

Foram persistidos somente `stockArchetype` e `sectorMetrics`: quatro emissores validados, cinco documentos correspondentes e nenhuma alteração no ranking publicado.

---

## 24. Shadow V3 — resultado após calibração OIL_GAS

O diagnóstico mostrou que o blend V2 ainda permitia ao motor genérico dominar produtoras. Exemplo: PRIO recebia baseline 10 porque Graham, ROE contra Selic e a penalidade cíclica genérica anulavam produção +42%, lifting cost de US$ 9,4 e margem EBITDA de 76%.

A V3 preserva o threshold global em 70 e não cria quota de BUY. Para `OIL_GAS_PRODUCER` com cobertura completa, usa 80% dos eixos setoriais e 20% do baseline legado como guarda. Os demais arquétipos permanecem no blend 20% eixos / 80% baseline.

Resultado integral: **287 ativos analisados, 203 pontuados, 202 prontos para calibração, 30 posições, 30 tickers únicos e zero duplicidade**.

### Top 10 Defensivo — shadow V3

| # | Ticker | Score | Ação |
|---:|---|---:|---|
| 1 | CMIG4 | 89 | BUY |
| 2 | ABCB4 | 81 | BUY |
| 3 | WIZC3 | 77 | BUY |
| 4 | TAEE11 | 76 | BUY |
| 5 | ITSA4 | 74 | BUY |
| 6 | INTB3 | 72 | BUY |
| 7 | ITUB4 | 72 | BUY |
| 8 | CPFE3 | 69 | WAIT |
| 9 | VLID3 | 63 | WAIT |
| 10 | VULC3 | 61 | WAIT |

### Top 10 Moderado — shadow V3

| # | Ticker | Score | Ação |
|---:|---|---:|---|
| 1 | MDNE3 | 95 | BUY |
| 2 | JHSF3 | 83 | BUY |
| 3 | PETR4 | 77 | BUY |
| 4 | POMO4 | 69 | WAIT |
| 5 | AZZA3 | 68 | WAIT |
| 6 | BMGB4 | 68 | WAIT |
| 7 | EUCA4 | 66 | WAIT |
| 8 | RIAA3 | 65 | WAIT |
| 9 | FIQE3 | 63 | WAIT |
| 10 | BRSR6 | 61 | WAIT |

### Top 10 Arrojado — shadow V3

| # | Ticker | Score | Ação |
|---:|---|---:|---|
| 1 | VTRU3 | 91 | BUY |
| 2 | EZTC3 | 84 | BUY |
| 3 | CYRE3 | 79 | BUY |
| 4 | DIRR3 | 75 | BUY |
| 5 | GMAT3 | 69 | WAIT |
| 6 | RECV3 | 69 | WAIT |
| 7 | CSED3 | 67 | WAIT |
| 8 | SHUL4 | 59 | WAIT |
| 9 | MILS3 | 56 | WAIT |
| 10 | CSUD3 | 55 | WAIT |

### Leitura das produtoras

- `PETR4`: eixos 76/96/72; score Moderado 77 (`BUY`), em 3º. Eficiência, escala, valuation e alavancagem compensam o risco estatal, que continua explícito na resiliência.
- `PRIO3`: durabilidade 94 e resiliência 67, mas entrada 31. A operação é excelente; o preço não oferece margem suficiente no snapshot. Permanece `WAIT` e fora do Top 10.
- `RECV3`: entrada 99 e resiliência 69, mas durabilidade 37 devido a produção -11% e lifting cost maior. Fica em 69/`WAIT`, 6º no Arrojado.
- `BRAV3`: eixos 57/61/64. A melhora financeira não neutraliza produção estagnada, custo maior e fragilidade dos fundamentos correntes. Permanece fora.

Validação: **101 arquivos e 865 testes do servidor aprovados**. O ranking de produção continua inalterado; a próxima etapa é integrar a V3 ao pipeline STOCK, gerar draft não publicado e validar a Auditoria Completa no admin antes de liberar `sync:prod` com a nova metodologia.

---

## 25. Integração V3 e draft final não publicado

A V3 foi integrada ao fluxo real de `aiResearchService.calculateRanking('STOCK')`. O mesmo ativo calibrado agora alimenta:

- o draft competitivo com 10 posições por perfil;
- a Auditoria Completa administrativa;
- o componente STOCK do Brasil 10;
- o threshold global `score >= 70 => BUY`.

Os eixos internos, a cobertura e a versão metodológica são persistidos somente em `content.fullAuditLog`. O `content.ranking`, destinado ao usuário, contém uma única recomendação coesa e não expõe `stockCalibration`, `coverage`, `shadowAuditByProfile` ou os três scores candidatos.

O primeiro `sync:prod` após a integração atualizou cotações e séries, mas o save do ranking foi bloqueado pelo Mongoose porque o marcador transitório `NaN` de métricas não aplicáveis não é BSON válido. Nenhum ranking foi publicado. A saída foi normalizada para `null` somente após o cálculo, preservando os scores, e o schema passou em teste de persistência. Em seguida, o batch foi regenerado somente com os dados já sincronizados.

### Batch final validado

- `batchId`: `6a5dd539da989f190e6af353`
- `runId`: `ed0a98e8-61b3-447e-af30-47ca46458fcd`
- `algorithmVersion`: `STOCK_BH_SHADOW_V3`;
- status: `COMPLETED`, sete classes concluídas, zero warning e zero failure;
- todas as flags de publicação: `false`;
- ponteiros de publicação para o draft: zero;
- STOCK: 30 posições, 30 tickers únicos, 10/10/10 por perfil;
- ações: 14 `BUY` e 16 `WAIT`;
- Auditoria Completa: 203 ativos, 202 calibráveis e BRAP4 excluída do draft por ausência de margem líquida e crescimento de receita;
- reconciliação ranking × auditoria: perfil, score e action idênticos para os 30 selecionados;
- vazamento de eixos no ranking público: nenhum.

Após a atualização de dados, `WIZC3` passou de 77 para 78 e `RECV3` de 69 para 68. Não houve mudança de composição nem de action. Petrobras permaneceu em 3º no Moderado, 77/`BUY`.

Validação de código: na regressão completa, 867 de 868 testes passaram na execução paralela; o único teste do logger sofreu colisão transitória de nome de arquivo e passou imediatamente quando reexecutado. Os 37 testes direcionados de calibração, persistência, OIL_GAS, Brasil 10 e contrato de ranking passaram após a correção final.

Conclusão: a metodologia V3 está pronta no código e existe um draft íntegro para revisão administrativa. O ranking atualmente publicado não foi substituído.
