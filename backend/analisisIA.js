// Agente de IA que sintetiza rotación de personal y ausentismo recurrente en
// un informe ejecutivo en español. No recalcula nada: toma los datos ya
// calculados por analisisRotacion.js / analisisAusentismo.js y le pide al
// modelo que los redacte como informe, sin inventar cifras.
//
// Usa Gemini (gratis, vía GEMINI_API_KEY) mientras no se configure una key
// de Anthropic. Para volver a Claude más adelante: cambiar el bloque de
// abajo por client.messages.create (@anthropic-ai/sdk, ya está instalado).

const { GoogleGenAI } = require('@google/genai');
const { calcularAusentismoUltimaSemana } = require('./analisisAusentismo');
const { calcularRotacionPersonal } = require('./analisisRotacion');

const MODELO = 'gemini-2.5-flash';

const SYSTEM_PROMPT = `Eres un analista de RRHH que redacta informes ejecutivos en español para una empresa
de logística en Chile (SGP - Control de Asistencia, con Centros de Distribución/CD y distintos cargos operativos).

Recibirás datos YA CALCULADOS de:
1) Rotación de personal: altas y bajas por mes (con desglose de bajas voluntarias/involuntarias), tasa de rotación,
   y resumen por cargo + CD.
2) Ausentismo recurrente: Falta Justificada / Injustificada ocurridas en la última semana de cada mes, trabajadores
   reincidentes (falta en 2+ meses distintos), y la serie mensual de faltas por cargo + CD (para ver tendencia).

Reglas estrictas:
- Usa ÚNICAMENTE las cifras entregadas. No inventes ni estimes números que no estén en los datos.
- Si un dato no permite una conclusión clara, dilo explícitamente en vez de sobre-interpretar.
- Sé concreto: cita cargos, CDs y cifras específicas, no generalidades vacías.
- Prioriza los hallazgos de mayor impacto (mayor tasa de rotación, mayor riesgo de ausentismo).

Estructura el informe en Markdown con exactamente estos títulos, en este orden:
## Resumen Ejecutivo
## Rotación de Personal
## Ausentismo y Riesgo de Reincidencia
## Recomendaciones

Máximo 500 palabras en total. No repitas ni cites la fecha del informe ni los datos de entrada
en tu respuesta — empieza directamente con "## Resumen Ejecutivo".`;

function resumirParaIA(ausentismo, rotacion) {
  const top = (arr, n) => arr.slice(0, n);
  return {
    ausentismo_recurrente: {
      periodo_analizado: ausentismo.meses_analizados,
      resumen_por_cargo: top(
        ausentismo.resumen_por_cargo.filter(r => r.total_faltas > 0).sort((a, b) => b.total_faltas - a.total_faltas),
        20
      ),
      // Sin rut ni nombre a propósito: el informe se envía a un proveedor de
      // IA externo (Gemini) y no queremos exponer datos personales de los
      // trabajadores — solo agregados por cargo + CD (ya vienen en
      // resumen_por_cargo.trabajadores_recurrentes).
      total_trabajadores_reincidentes: ausentismo.trabajadores_recurrentes.length,
    },
    rotacion_personal: {
      periodo_analizado: rotacion.meses_analizados,
      serie_mensual: rotacion.serie_mensual,
      resumen_por_cargo: top(
        rotacion.resumen_por_cargo.filter(r => r.bajas > 0 || r.altas > 0),
        20
      ),
    },
  };
}

async function generarInformeIA(pool, filtros) {
  const { mesesAtras = 6, cds } = filtros;

  const [ausentismo, rotacion] = await Promise.all([
    calcularAusentismoUltimaSemana(pool, { mesesAtras, cds }),
    calcularRotacionPersonal(pool, { mesesAtras, cds }),
  ]);

  const datos = resumirParaIA(ausentismo, rotacion);

  if (!process.env.GEMINI_API_KEY) {
    const err = new Error('Falta configurar GEMINI_API_KEY en el servidor (.env) para poder generar informes con IA.');
    err.sinApiKey = true;
    throw err;
  }

  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  const hoy = new Date().toISOString().slice(0, 10);

  let response;
  try {
    response = await ai.models.generateContent({
      model: MODELO,
      contents: `Fecha del informe: ${hoy}\n\nDatos (JSON):\n${JSON.stringify(datos)}`,
      config: {
        systemInstruction: SYSTEM_PROMPT,
        maxOutputTokens: 8192,
        // Sin esto, Gemini 2.5 Flash gasta parte de maxOutputTokens en
        // "pensamiento" interno antes de responder, y puede cortar la
        // narrativa a mitad de camino. No lo necesitamos: es solo redactar
        // a partir de datos ya calculados, no razonar un problema nuevo.
        thinkingConfig: { thinkingBudget: 0 },
      },
    });
  } catch (err) {
    // El free tier de Gemini a veces satura el modelo (503 UNAVAILABLE) —
    // es transitorio, no un bug: se le indica al usuario que reintente.
    if (String(err.message || '').includes('UNAVAILABLE') || err.status === 503) {
      throw new Error('El servicio de IA (Gemini, plan gratuito) está saturado en este momento. Intenta de nuevo en unos segundos.');
    }
    throw err;
  }

  // Por si el modelo antepone texto suelto (ej. repite la fecha) antes del
  // primer título — nos quedamos solo desde ahí.
  const textoCrudo = response.text || '';
  const indiceInicio = textoCrudo.indexOf('## ');
  const narrativa = indiceInicio >= 0 ? textoCrudo.slice(indiceInicio) : textoCrudo;
  const periodo = ausentismo.meses_analizados[ausentismo.meses_analizados.length - 1]?.etiqueta || hoy.slice(0, 7);

  return { periodo, narrativa, datos };
}

module.exports = { generarInformeIA };
