const {
  Document, Packer, Paragraph, TextRun, AlignmentType, Table, TableRow, TableCell,
  WidthType, BorderStyle, VerticalAlign,
} = require('docx');

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

function fechaEnPalabras(fechaISO) {
  const [anio, mes, dia] = fechaISO.split('-').map(Number);
  return `${dia} de ${MESES[mes - 1]} de ${anio}`;
}

function parrafo(texto, opciones = {}) {
  return new Paragraph({
    alignment: opciones.align || AlignmentType.JUSTIFIED,
    spacing: { after: opciones.espacio ?? 160 },
    children: [new TextRun({ text: texto, bold: !!opciones.bold, italics: !!opciones.italic, size: opciones.size || 22 })],
  });
}

function parrafoNegrita(texto, opciones = {}) {
  return parrafo(texto, { ...opciones, bold: true });
}

function bloqueCitado(texto) {
  return texto.split('\n\n').map(parte => new Paragraph({
    alignment: AlignmentType.JUSTIFIED,
    indent: { left: 360 },
    spacing: { after: 160 },
    children: [new TextRun({ text: parte, italics: true, size: 21 })],
  }));
}

function celda(texto, opciones = {}) {
  return new TableCell({
    width: { size: opciones.width || 25, type: WidthType.PERCENTAGE },
    verticalAlign: VerticalAlign.CENTER,
    borders: {
      top: { style: BorderStyle.SINGLE, size: 2, color: '999999' },
      bottom: { style: BorderStyle.SINGLE, size: 2, color: '999999' },
      left: { style: BorderStyle.NONE }, right: { style: BorderStyle.NONE },
    },
    children: [new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: texto, bold: !!opciones.bold, size: 18 })],
    })],
  });
}

function tablaAtrasosDocx(filas) {
  const filasTabla = [
    new TableRow({
      children: [
        celda('Fecha', { bold: true, width: 20 }),
        celda('Hora de ingreso Establecida', { bold: true, width: 32 }),
        celda('Hora de entrada', { bold: true, width: 26 }),
        celda('Retraso', { bold: true, width: 22 }),
      ],
    }),
    ...filas.map(f => new TableRow({
      children: [
        celda(f.fecha, { width: 20 }),
        celda(f.esperada, { width: 32 }),
        celda(f.real, { width: 26 }),
        celda(`${f.retraso} min`, { width: 22 }),
      ],
    })),
  ];
  return new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: filasTabla });
}

// Genera la carta de amonestación en Word (.docx), con el mismo modelo legal
// fijo y contenido dinámico que la versión en PDF (generarAmonestacionPDF).
async function generarAmonestacionDOCX({ nombreTrabajador, run, direccion, comuna, fecha, causal, tablaAtrasos }) {
  const hijos = [];

  hijos.push(parrafo(`Santiago, ${fechaEnPalabras(fecha)}`, { align: AlignmentType.LEFT, espacio: 240 }));

  hijos.push(parrafoNegrita('SEÑOR(A)', { espacio: 40 }));
  hijos.push(parrafoNegrita(nombreTrabajador.toUpperCase(), { espacio: 40 }));
  hijos.push(parrafoNegrita(run, { espacio: 40 }));
  hijos.push(parrafoNegrita(direccion || '[DIRECCIÓN NO REGISTRADA]', { espacio: 40 }));
  hijos.push(parrafoNegrita(comuna || '[COMUNA NO REGISTRADA]', { espacio: 40 }));
  hijos.push(parrafoNegrita('PRESENTE', { espacio: 200 }));

  hijos.push(parrafoNegrita('Ref. Amonestación.', { espacio: 160 }));

  hijos.push(parrafo('De nuestra consideración:'));

  hijos.push(parrafo(
    'Por medio de la presente y dando cumplimiento a su contrato de trabajo, la legislación ' +
    'vigente y en conformidad al Reglamento Interno de Orden, Higiene y Seguridad de la empresa ' +
    'MANPOWER SERVICIOS INTEGRALES SPA., lo venimos en amonestar, por escrito, debido a los ' +
    'siguientes incumplimientos de sus obligaciones y funciones conforme a su contrato de trabajo:'
  ));

  hijos.push(parrafo(
    'Hemos podido constatar que, usted ha incurrido en causales de incumplimiento de las ' +
    'obligaciones que impone el Reglamento Interno de Orden, Higiene y Seguridad de la empresa, ' +
    'específicamente ha incumplido las siguientes obligaciones:'
  ));

  hijos.push(...bloqueCitado(
    '“TÍTULO XIV – DE LAS OBLIGACIONES DEL TRABAJADOR\n\n' +
    'Artículo 88. Es obligación legal, contractual y reglamentaria, de carácter principal, el ' +
    'que todo Trabajador cumpla fiel y estrictamente las obligaciones que emanan de su Contrato ' +
    'Individual de Trabajo y de los convenios o contratos colectivos vigentes, cuando sean partes ' +
    'de éstos, de la legislación laboral y previsional y de todas y cada una de las disposiciones ' +
    'del presente Reglamento, además de conducirse mediante los procedimientos y Políticas que la ' +
    'empresa ha implementado o implementará, debiendo además observar fielmente las obligaciones, ' +
    'prohibiciones y órdenes que correspondan a las prácticas e instrucciones de la Empresa y de ' +
    'sus respectivas jefaturas, que sean inherentes al buen desempeño de sus funciones.\n\n' +
    'Artículo 89. Entre otras, serán obligaciones reglamentarias, esenciales y comunes a todos los ' +
    'Trabajadores de la Empresa, de manera enunciativa las siguientes:\n\n' +
    '2) Obligaciones. a) Obligación de diligencia. En cuya virtud deberá acatar fiel y ' +
    'oportunamente todas y cada una de las instrucciones que le imparten sus jefes tanto verbales ' +
    'como mediante medios digitales de comunicación, como asimismo cumplir las normas de higiene y ' +
    'seguridad en el trabajo, particularmente aquellas de que dan cuenta los avisos puestos por la ' +
    'empresa en los lugares en que se desarrollan faenas; Prestar sus servicios personales y ' +
    'hacerlo en forma leal y eficiente.”'
  ));

  hijos.push(parrafo(
    'Como también vulnerar las normas contempladas en el Reglamento Interno relacionadas con ' +
    'prevención y seguridad en el trabajo. Adicionalmente a infringido la siguiente cláusula de su ' +
    'contrato de trabajo:'
  ));

  hijos.push(...bloqueCitado(
    '“Quinto. Obligaciones. Sin perjuicio de las estipulaciones del Reglamento Interno de Orden, ' +
    'Higiene y Seguridad que forma parte integrante de este contrato de trabajo, las partes dejan ' +
    'constancia expresa que son obligaciones principales del trabajador, con el carácter de ' +
    'esenciales, entre otras, y sin que esta enumeración sea taxativa, las siguientes:\n\n' +
    '2. Cumplir y observar fielmente, en el desempeño de sus funciones, todas las instrucciones en ' +
    'general, órdenes y normas de atención que le sean impartidas por el personal de la empresa ' +
    'revestido de autoridad suficiente. Corresponde exclusivamente a ésta, determinar qué personal ' +
    'tiene tal autoridad.”'
  ));

  // --- Bloque dinámico ---
  hijos.push(parrafoNegrita(`Esto, a raíz que ${causal}`));

  if (Array.isArray(tablaAtrasos) && tablaAtrasos.length > 0) {
    hijos.push(tablaAtrasosDocx(tablaAtrasos));
    hijos.push(new Paragraph({ text: '', spacing: { after: 160 } }));
    const totalMin = tablaAtrasos.reduce((acc, f) => acc + f.retraso, 0);
    hijos.push(parrafoNegrita(
      `En total, durante el período registró ${tablaAtrasos.length} día(s) con atraso, ` +
      `equivalentes a ${totalMin} minutos de atraso acumulados.`
    ));
  }

  hijos.push(parrafo(
    'Este hecho constituye un incumplimiento a las obligaciones que impone su contrato de ' +
    'trabajo y al Reglamento Interno de Orden, Higiene y Seguridad de la empresa.'
  ));

  hijos.push(parrafo(
    'Esperamos que tome en cuenta esta situación y que se traduzca en un cambio positivo en su ' +
    'accionar, dado que para la entidad en la cual usted trabaja es de suma importancia que usted ' +
    'cumpla de manera correcta con sus funciones laborales, protocolos e instrucciones.'
  ));

  hijos.push(parrafo(
    'A fin de corregir las situaciones expuestas, que constituyen una falta a sus obligaciones ' +
    'contractuales y laborales, y evitar sanciones posteriores, le solicitamos encarecidamente no ' +
    'repetir dichas conductas, modificando su comportamiento, puesto que, de lo contrario, se ' +
    'adoptarán las medidas que en derecho correspondan.'
  ));

  hijos.push(parrafo('Sin otro particular, saluda atentamente a Usted.', { espacio: 500 }));

  // --- Firma (tabla de 2 columnas sin bordes, para alinear ambas firmas) ---
  hijos.push(new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: {
      top: { style: BorderStyle.NONE }, bottom: { style: BorderStyle.NONE },
      left: { style: BorderStyle.NONE }, right: { style: BorderStyle.NONE },
      insideHorizontal: { style: BorderStyle.NONE }, insideVertical: { style: BorderStyle.NONE },
    },
    rows: [
      new TableRow({
        children: [
          new TableCell({ width: { size: 50, type: WidthType.PERCENTAGE }, children: [
            new Paragraph({ children: [new TextRun({ text: 'Manpower Servicios Integrales SpA.', bold: true, size: 21 })] }),
          ] }),
          new TableCell({ width: { size: 50, type: WidthType.PERCENTAGE }, children: [
            new Paragraph({ children: [new TextRun({ text: nombreTrabajador.toUpperCase(), bold: true, size: 21 })] }),
          ] }),
        ],
      }),
      new TableRow({
        children: [
          new TableCell({ children: [new Paragraph({ text: '' })] }),
          new TableCell({ children: [new Paragraph({ text: '' })] }),
        ],
      }),
      new TableRow({
        children: [
          new TableCell({ children: [
            new Paragraph({ children: [new TextRun({ text: 'RUT N° 80.581.500-0', size: 21 })] }),
          ] }),
          new TableCell({ children: [
            new Paragraph({ children: [new TextRun({ text: `RUN N° ${run}`, size: 21 })] }),
          ] }),
        ],
      }),
    ],
  }));

  hijos.push(new Paragraph({ text: '', spacing: { before: 400 } }));
  hijos.push(new Paragraph({ children: [new TextRun({ text: 'C.C.: Archivo', size: 20 })] }));
  hijos.push(new Paragraph({ children: [new TextRun({ text: 'C.C.: Trabajador.', size: 20 })] }));
  hijos.push(new Paragraph({ children: [new TextRun({ text: 'C.C.: Inspección del Trabajo.', size: 20 })] }));

  const doc = new Document({
    sections: [{
      properties: { page: { margin: { top: 1000, bottom: 1000, left: 1000, right: 1000 } } },
      children: hijos,
    }],
  });

  return Packer.toBuffer(doc);
}

module.exports = { generarAmonestacionDOCX };