/**
 * Gera e SALVA o texto Explainable IA do draft mais recente de cada classe,
 * usando o prompt já montado pelo crunch/sync (`explainableAIPrompt`).
 *
 * Não publica nada: apenas preenche `generatedExplainableAI` para que a seção
 * deixe de aparecer como "sem conteúdo" no "Publicar Tudo Pendente".
 *
 * Uso:
 *   npm run generate:xai            → só as classes sem texto salvo
 *   npm run generate:xai -- --force → regera também as que já têm texto
 *   npm run generate:xai -- --dry   → só relata o que faria, sem chamar a IA
 *   npm run generate:xai -- --class=STOCK,FII
 */
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

process.env.NODE_ENV = 'local_sync';

const ALL_CLASSES = ['STOCK', 'FII', 'CRYPTO', 'BRASIL_10', 'STOCK_US', 'REIT', 'ETF'];

const args = process.argv.slice(2);
const hasFlag = (name) => args.includes(`--${name}`);
const flagValue = (name) => args.find(a => a.startsWith(`--${name}=`))?.split('=')[1];

const force = hasFlag('force');
const dryRun = hasFlag('dry');
const classes = (flagValue('class')?.split(',').map(c => c.trim().toUpperCase()).filter(Boolean)) || ALL_CLASSES;

const run = async () => {
  if (!process.env.MONGO_URI) throw new Error('MONGO_URI não definida.');
  if (!dryRun && !process.env.API_KEY) throw new Error('API_KEY não definida (necessária para chamar o Gemini).');

  await mongoose.connect(process.env.MONGO_URI);
  console.log(`\nConexão DB estabelecida.${dryRun ? '  [DRY RUN — nada será gravado]' : ''}\n`);

  const { default: MarketAnalysis } = await import('../models/MarketAnalysis.js');
  const { generateExplainableText, saveExplainableText } = await import('../services/explainableAIService.js');

  const summary = { generated: [], skipped: [], failed: [] };

  for (const assetClass of classes) {
    const analysis = await MarketAnalysis.findOne({ assetClass, strategy: 'BUY_HOLD' }).sort({ createdAt: -1 });

    if (!analysis) {
      summary.skipped.push(`${assetClass}: nenhum draft encontrado`);
      console.log(`- ${assetClass.padEnd(10)} sem draft`);
      continue;
    }
    if (!analysis.explainableAIPrompt) {
      summary.skipped.push(`${assetClass}: prompt ausente (rode o crunch/sync antes)`);
      console.log(`- ${assetClass.padEnd(10)} prompt ausente — rode o crunch/sync antes`);
      continue;
    }
    if (String(analysis.generatedExplainableAI || '').trim() && !force) {
      summary.skipped.push(`${assetClass}: já tem texto (use --force para regerar)`);
      console.log(`- ${assetClass.padEnd(10)} já tem texto — pulando (--force para regerar)`);
      continue;
    }
    if (dryRun) {
      summary.generated.push(`${assetClass}: geraria (prompt de ${analysis.explainableAIPrompt.length} chars)`);
      console.log(`- ${assetClass.padEnd(10)} geraria agora (prompt: ${analysis.explainableAIPrompt.length} chars)`);
      continue;
    }

    try {
      process.stdout.write(`- ${assetClass.padEnd(10)} gerando... `);
      const text = await generateExplainableText(analysis);
      saveExplainableText(analysis, text);
      await analysis.save();
      summary.generated.push(`${assetClass}: ${text.length} chars`);
      console.log(`ok (${text.length} chars)`);
    } catch (error) {
      summary.failed.push(`${assetClass}: ${error.message}`);
      console.log(`FALHOU — ${error.message}`);
    }
  }

  console.log('\n──────── resumo ────────');
  console.log(`gerados: ${summary.generated.length}   pulados: ${summary.skipped.length}   falhas: ${summary.failed.length}`);
  summary.skipped.forEach(s => console.log(`  pulado  ${s}`));
  summary.failed.forEach(s => console.log(`  falha   ${s}`));
  if (summary.generated.length && !dryRun) {
    console.log('\nTexto salvo. Nada foi publicado — use "Publicar Tudo Pendente" no painel.');
  }

  await mongoose.disconnect();
  process.exit(summary.failed.length ? 1 : 0);
};

run().catch(async (error) => {
  console.error(`\nErro fatal: ${error.message}`);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
