const PDFDocument = require('pdfkit');

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

function fechaEnPalabras(fechaISO) {
  const [anio, mes, dia] = fechaISO.split('-').map(Number);
  return `${dia} de ${MESES[mes - 1]} de ${anio}`;
}

// Genera el PDF de la carta de amonestación, con el modelo legal fijo de la
// empresa y el detalle del causal como único bloque variable.
function generarAmonestacionPDF({ nombreTrabajador, run, direccion, comuna, fecha, causal, tablaAtrasos }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 65, size: 'LETTER' });
    const buffers = [];
    doc.on('data', b => buffers.push(b));
    doc.on('end', () => resolve(Buffer.concat(buffers)));
    doc.on('error', reject);

    const anchoTexto = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    doc.font('Times-Roman').fontSize(11);

    function parrafo(texto, opciones = {}) {
      doc.font(opciones.font || 'Times-Roman').fontSize(opciones.size || 11);
      doc.text(texto, { align: opciones.align || 'justify', width: anchoTexto, ...opciones });
      doc.moveDown(opciones.espacio ?? 0.8);
    }

    function parrafoNegrita(texto, opciones = {}) {
      parrafo(texto, { ...opciones, font: 'Times-Bold' });
    }

    function bloqueCitado(texto) {
      doc.font('Times-Italic').fontSize(10.5);
      doc.text(texto, { align: 'justify', width: anchoTexto - 20, indent: 20 });
      doc.moveDown(0.8);
    }

    function tablaAtrasosDibujo(filas) {
      const columnas = [
        { header: 'Fecha', clave: 'fecha', width: anchoTexto * 0.20 },
        { header: 'Hora de ingreso Establecida', clave: 'esperada', width: anchoTexto * 0.32 },
        { header: 'Hora de entrada', clave: 'real', width: anchoTexto * 0.26 },
        { header: 'Retraso', clave: 'retraso', width: anchoTexto * 0.22 },
      ];
      const alturaFila = 18;
      const startX = doc.page.margins.left;
      const finX = startX + anchoTexto;

      function dibujarEncabezado() {
        let x = startX;
        const yIni = doc.y;
        doc.font('Times-Bold').fontSize(9);
        for (const c of columnas) {
          doc.text(c.header, x + 3, yIni, { width: c.width - 6, align: 'center' });
          x += c.width;
        }
        doc.y = yIni + 26;
        doc.moveTo(startX, doc.y - 3).lineTo(finX, doc.y - 3).lineWidth(0.8).stroke();
      }

      dibujarEncabezado();
      doc.font('Times-Roman').fontSize(9.5);
      for (const fila of filas) {
        if (doc.y + alturaFila > doc.page.height - doc.page.margins.bottom) {
          doc.addPage();
          doc.y = doc.page.margins.top;
          dibujarEncabezado();
          doc.font('Times-Roman').fontSize(9.5);
        }
        let x = startX;
        const yFila = doc.y;
        const valores = [fila.fecha, fila.esperada, fila.real, `${fila.retraso} min`];
        for (let i = 0; i < columnas.length; i++) {
          doc.text(valores[i], x + 3, yFila, { width: columnas[i].width - 6, align: 'center' });
          x += columnas[i].width;
        }
        doc.y = yFila + alturaFila;
      }
      doc.moveTo(startX, doc.y).lineTo(finX, doc.y).lineWidth(0.8).stroke();
      doc.x = startX;
      doc.moveDown(1);
    }

    // --- Encabezado ---
    parrafo(`Santiago, ${fechaEnPalabras(fecha)}`, { align: 'left', espacio: 1.2 });

    parrafoNegrita('SEÑOR(A)', { espacio: 0.2 });
    parrafoNegrita(nombreTrabajador.toUpperCase(), { espacio: 0.2 });
    parrafoNegrita(run, { espacio: 0.2 });
    parrafoNegrita(direccion || '[DIRECCIÓN NO REGISTRADA]', { espacio: 0.2 });
    parrafoNegrita(comuna || '[COMUNA NO REGISTRADA]', { espacio: 0.2 });
    parrafoNegrita('PRESENTE', { espacio: 1 });

    parrafoNegrita('Ref. Amonestación.', { espacio: 0.8 });

    parrafo('De nuestra consideración:');

    parrafo(
      'Por medio de la presente y dando cumplimiento a su contrato de trabajo, la legislación ' +
      'vigente y en conformidad al Reglamento Interno de Orden, Higiene y Seguridad de la empresa ' +
      'MANPOWER SERVICIOS INTEGRALES SPA., lo venimos en amonestar, por escrito, debido a los ' +
      'siguientes incumplimientos de sus obligaciones y funciones conforme a su contrato de trabajo:'
    );

    parrafo(
      'Hemos podido constatar que, usted ha incurrido en causales de incumplimiento de las ' +
      'obligaciones que impone el Reglamento Interno de Orden, Higiene y Seguridad de la empresa, ' +
      'específicamente ha incumplido las siguientes obligaciones:'
    );

    bloqueCitado(
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
    );

    parrafo(
      'Como también vulnerar las normas contempladas en el Reglamento Interno relacionadas con ' +
      'prevención y seguridad en el trabajo. Adicionalmente a infringido la siguiente cláusula de su ' +
      'contrato de trabajo:'
    );

    bloqueCitado(
      '“Quinto. Obligaciones. Sin perjuicio de las estipulaciones del Reglamento Interno de Orden, ' +
      'Higiene y Seguridad que forma parte integrante de este contrato de trabajo, las partes dejan ' +
      'constancia expresa que son obligaciones principales del trabajador, con el carácter de ' +
      'esenciales, entre otras, y sin que esta enumeración sea taxativa, las siguientes:\n\n' +
      '2. Cumplir y observar fielmente, en el desempeño de sus funciones, todas las instrucciones en ' +
      'general, órdenes y normas de atención que le sean impartidas por el personal de la empresa ' +
      'revestido de autoridad suficiente. Corresponde exclusivamente a ésta, determinar qué personal ' +
      'tiene tal autoridad.”'
    );

    // --- Bloque dinámico: el causal específico de esta amonestación ---
    parrafoNegrita(`Esto, a raíz que ${causal}`, { font: 'Times-Bold' });

    if (Array.isArray(tablaAtrasos) && tablaAtrasos.length > 0) {
      tablaAtrasosDibujo(tablaAtrasos);
      const totalMin = tablaAtrasos.reduce((acc, f) => acc + f.retraso, 0);
      parrafoNegrita(
        `En total, durante el período registró ${tablaAtrasos.length} día(s) con atraso, ` +
        `equivalentes a ${totalMin} minutos de atraso acumulados.`
      );
    }

    parrafo(
      'Este hecho constituye un incumplimiento a las obligaciones que impone su contrato de ' +
      'trabajo y al Reglamento Interno de Orden, Higiene y Seguridad de la empresa.'
    );

    parrafo(
      'Esperamos que tome en cuenta esta situación y que se traduzca en un cambio positivo en su ' +
      'accionar, dado que para la entidad en la cual usted trabaja es de suma importancia que usted ' +
      'cumpla de manera correcta con sus funciones laborales, protocolos e instrucciones.'
    );

    parrafo(
      'A fin de corregir las situaciones expuestas, que constituyen una falta a sus obligaciones ' +
      'contractuales y laborales, y evitar sanciones posteriores, le solicitamos encarecidamente no ' +
      'repetir dichas conductas, modificando su comportamiento, puesto que, de lo contrario, se ' +
      'adoptarán las medidas que en derecho correspondan.'
    );

    parrafo('Sin otro particular, saluda atentamente a Usted.', { espacio: 2.5 });

    // --- Firma ---
    const colIzq = doc.page.margins.left;
    const colDer = doc.page.width / 2 + 20;
    const yFirma = doc.y;
    doc.font('Times-Bold').fontSize(10.5);
    doc.text('Manpower Servicios Integrales SpA.', colIzq, yFirma, { width: doc.page.width / 2 - 40 });
    doc.text(nombreTrabajador.toUpperCase(), colDer, yFirma, { width: doc.page.width / 2 - 40 });
    doc.moveDown(1.5);
    const yRut = doc.y;
    doc.font('Times-Roman').fontSize(10.5);
    doc.text('RUT N° 80.581.500-0', colIzq, yRut, { width: doc.page.width / 2 - 40 });
    doc.text(`RUN N° ${run}`, colDer, yRut, { width: doc.page.width / 2 - 40 });

    doc.moveDown(3);
    doc.font('Times-Roman').fontSize(10);
    doc.text('C.C.: Archivo', colIzq);
    doc.text('C.C.: Trabajador.', colIzq);
    doc.text('C.C.: Inspección del Trabajo.', colIzq);

    doc.end();
  });
}

module.exports = { generarAmonestacionPDF };