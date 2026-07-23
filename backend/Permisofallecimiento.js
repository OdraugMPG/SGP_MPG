const { sumarDias } = require('./importar');

// Valores vigentes del Art. 66 del Código del Trabajo (Chile), incluyendo la
// ampliación por hermano/a de la Ley N°21.441. Hay proyectos de ley en trámite
// para ampliar estos plazos, pero no son ley todavía — si cambian, hay que
// actualizar esta tabla.
const DIAS_FALLECIMIENTO = {
  hijo: { dias: 10, tipo_dia: 'corridos', label: 'Hijo/a' },
  conyuge: { dias: 7, tipo_dia: 'corridos', label: 'Cónyuge o conviviente civil' },
  hijo_gestacion: { dias: 7, tipo_dia: 'habiles', label: 'Hijo/a en gestación (muerte fetal)' },
  padre_madre_hermano: { dias: 4, tipo_dia: 'habiles', label: 'Padre, madre o hermano/a' },
};

// "Día hábil" se calcula según el calendario laboral REAL del trabajador
// (no un genérico), porque eso es lo que efectivamente le da días de
// descanso adicionales:
//   - Rotativo (AM/PM): trabaja Lunes a Sábado -> hábil excluye solo Domingo.
//   - Noche y Plano: trabajan Lunes a Viernes -> hábil excluye Sábado y Domingo.
//   - Si no se conoce el turno del trabajador, se usa el criterio genérico
//     (excluye solo Domingo) como respaldo, indicándolo en la respuesta.
function esDiaHabil(fechaISO, tipoTurno) {
  const dow = new Date(fechaISO + 'T00:00:00').getDay(); // 0=Dom ... 6=Sáb
  if (tipoTurno === 'NOCHE' || tipoTurno === 'PLANO') {
    return dow !== 0 && dow !== 6; // excluye sábado y domingo
  }
  return dow !== 0; // Rotativo (AM/PM) o desconocido: excluye solo domingo
}

// Calcula la fecha de término del permiso, contando desde la fecha de
// fallecimiento (que siempre cuenta como día 1, tal como indica la ley:
// "estos permisos deberán hacerse efectivos a partir del día del respectivo
// fallecimiento"). tipoTurno: 'NOCHE' | 'PLANO' | 'AMPM' | null.
function calcularFechaFinFallecimiento(fechaInicio, parentesco, tipoTurno = null) {
  const config = DIAS_FALLECIMIENTO[parentesco];
  if (!config) return null;

  if (config.tipo_dia === 'corridos') {
    return sumarDias(fechaInicio, config.dias - 1);
  }

  let contados = 1;
  let fecha = fechaInicio;
  while (contados < config.dias) {
    fecha = sumarDias(fecha, 1);
    if (esDiaHabil(fecha, tipoTurno)) contados++;
  }
  return fecha;
}

module.exports = { DIAS_FALLECIMIENTO, calcularFechaFinFallecimiento };