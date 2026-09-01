// Convierte texto en Markdown simple (## títulos, listas con "- ", párrafos)
// en elementos React, sin depender de una librería externa — usado por los
// informes que devuelve el agente de IA (siempre piden ese formato acotado).
export function renderizarNarrativa(texto) {
  const lineas = (texto || '').split('\n');
  const bloques = [];
  let listaBuffer = [];

  function cerrarLista(key) {
    if (listaBuffer.length > 0) {
      bloques.push(
        <ul key={`ul-${key}`} style={{ margin: '6px 0 14px', paddingLeft: 20 }}>
          {listaBuffer.map((item, idx) => <li key={idx} style={{ marginBottom: 4 }}>{item}</li>)}
        </ul>
      );
      listaBuffer = [];
    }
  }

  lineas.forEach((linea, i) => {
    const t = linea.trim();
    if (t.startsWith('## ')) {
      cerrarLista(i);
      bloques.push(<h3 key={i} style={{ marginTop: 20, marginBottom: 8, fontFamily: 'var(--font-sans)' }}>{t.slice(3)}</h3>);
    } else if (t.startsWith('- ') || t.startsWith('* ')) {
      listaBuffer.push(t.slice(2).replace(/\*\*/g, ''));
    } else if (t === '') {
      cerrarLista(i);
    } else {
      cerrarLista(i);
      bloques.push(<p key={i} style={{ margin: '6px 0', lineHeight: 1.55 }}>{t.replace(/\*\*/g, '')}</p>);
    }
  });
  cerrarLista('final');
  return bloques;
}
