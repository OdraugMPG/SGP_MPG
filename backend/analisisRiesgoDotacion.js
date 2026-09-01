// Agente de IA que analiza la matriz de dotación (todos los cargos de un CD)
// y redacta un informe de riesgos: subdotación (falta gente para cubrir lo
// pedido por el cliente) y sobredotación (si el 100% de los contratados,
// incluido el backup, llega un mismo día, sobra gente respecto a lo pedido).
// No recalcula nada: la matriz ya viene calculada (incluyendo lo que el
// usuario haya simulado como "nuevo requerido"), y el modelo solo la
// interpreta — igual que analisisIA.js para rotación/ausentismo.

const { GoogleGenAI } = require('@google/genai');

const MODELO = 'gemini-2.5-flash';

const SYSTEM_PROMPT = `Eres un analista de dotación de personal (workforce planning) para una empresa
de logística en Chile, con Centros de Distribución (CD) y distintos cargos operativos.

Recibirás una matriz YA CALCULADA con, para cada cargo de un CD: el turno al que corresponde esa fila
("Todos los turnos" si es el cargo completo, o uno específico — AM, PM, "Rotativo (AM+PM)", Noche o
Plano — si el usuario filtró a ese turno puntual), el requerido actual del cliente, el nuevo requerido
que el usuario está simulando (puede ser igual al actual si no simuló nada), el % de ausentismo
histórico real de ese turno, la dotación mínima sugerida a contratar (requerido / (1 - ausentismo)),
cuánto de esa dotación mínima es "sobre lo pedido" (backup), la dotación activa contratada hoy, la
brecha vs. esa dotación activa, y con qué frecuencia histórica (% de días) la asistencia real YA
superó lo que pedía el cliente ese día (esto mide sobredotación real, no teórica). Si dos filas
muestran el mismo cargo en turnos distintos, trátalas como situaciones separadas — el mismo cargo
puede tener subdotación en un turno y sobredotación en otro.

Tu trabajo es identificar dos tipos de riesgo, usando SOLO las cifras entregadas (no inventes ni
estimes nada que no esté en los datos):

1) RIESGO DE SUBDOTACIÓN: cargos donde la dotación activa está muy por debajo de la dotación mínima
   sugerida — riesgo de no cubrir lo que pide el cliente si hay ausentismo normal.

2) RIESGO DE SOBREDOTACIÓN: cargos donde, si TODOS los contratados (incluido el backup) llegan un
   mismo día, quedaría gente ociosa por sobre lo requerido. Usa el dato de "frecuencia histórica de
   sobredotación" para distinguir un riesgo puramente teórico (frecuencia baja o 0%) de algo que YA
   está pasando seguido (frecuencia alta) — eso último es plata que se está perdiendo hoy, no un
   escenario hipotético.

Prioriza los cargos de mayor impacto (brecha más grande, frecuencia de sobredotación más alta). Sé
concreto: cita cargos y cifras específicas.

Estructura el informe en Markdown con exactamente estos títulos, en este orden:
## Resumen Ejecutivo
## Riesgo de Subdotación
## Riesgo de Sobredotación
## Recomendaciones

Máximo 500 palabras en total. No repitas los datos de entrada en tu respuesta — empieza directamente
con "## Resumen Ejecutivo".`;

async function generarAnalisisRiesgoDotacion({ cd, filas }) {
  if (!process.env.GEMINI_API_KEY) {
    const err = new Error('Falta configurar GEMINI_API_KEY en el servidor (.env) para poder generar el análisis con IA.');
    err.sinApiKey = true;
    throw err;
  }

  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  const hoy = new Date().toISOString().slice(0, 10);
  const datos = { cd, fecha: hoy, cargos: filas };

  let response;
  try {
    response = await ai.models.generateContent({
      model: MODELO,
      contents: `CD: ${cd}\n\nMatriz de cargos (JSON):\n${JSON.stringify(datos)}`,
      config: {
        systemInstruction: SYSTEM_PROMPT,
        maxOutputTokens: 8192,
        // Sin esto, Gemini 2.5 Flash gasta parte de maxOutputTokens en
        // "pensamiento" interno antes de responder, y puede cortar la
        // narrativa a mitad de camino (es lo que pasó: se quedó en "Riesgo
        // de..."). No lo necesitamos para esta tarea de redacción.
        thinkingConfig: { thinkingBudget: 0 },
      },
    });
  } catch (err) {
    if (String(err.message || '').includes('UNAVAILABLE') || err.status === 503) {
      throw new Error('El servicio de IA (Gemini, plan gratuito) está saturado en este momento. Intenta de nuevo en unos segundos.');
    }
    throw err;
  }

  const textoCrudo = response.text || '';
  const indiceInicio = textoCrudo.indexOf('## ');
  const narrativa = indiceInicio >= 0 ? textoCrudo.slice(indiceInicio) : textoCrudo;

  return { narrativa };
}

module.exports = { generarAnalisisRiesgoDotacion };
