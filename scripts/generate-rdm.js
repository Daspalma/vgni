import { chromium } from 'playwright-core';
import { mkdir, readFile, copyFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const executablePath = process.env.BROWSER_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const browser = await chromium.launch({
  executablePath,
  headless: true
});

try {
  await mkdir(new URL('../output/pdf/', import.meta.url), { recursive: true });
  await mkdir(new URL('../docs/', import.meta.url), { recursive: true });

  const page = await browser.newPage();
  await page.setContent(await readFile(new URL('../docs/ficha-rdm.html', import.meta.url), 'utf8'));
  
  const targetDocPath = fileURLToPath(new URL('../docs/Ficha_RDM_EstuLanches.pdf', import.meta.url));
  const targetOutputPath = fileURLToPath(new URL('../output/pdf/Ficha-RDM-EstuLanches.pdf', import.meta.url));

  await page.pdf({
    path: targetDocPath,
    format: 'A4',
    printBackground: true,
    preferCSSPageSize: true,
    tagged: true
  });

  await copyFile(targetDocPath, targetOutputPath);

  console.log(`Gerado com sucesso: ${targetDocPath}`);
  console.log(`Cópia sincronizada: ${targetOutputPath}`);
} finally {
  await browser.close();
}
