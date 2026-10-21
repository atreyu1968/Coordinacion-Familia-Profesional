const storageItems = [
  {
    name: "coordina_adg_token",
    type: "Almacenamiento local",
    purpose: "Mantener la identificación y autorizar las peticiones a la aplicación.",
    duration: "No tiene una caducidad automática en el navegador. Se elimina al cerrar sesión desde la aplicación o al borrar los datos del sitio. La validez del acceso se comprueba en el servidor.",
  },
  {
    name: "coordina_adg_sidebar_pinned",
    type: "Almacenamiento local",
    purpose: "Recordar si prefieres mantener fijo el menú lateral.",
    duration: "Hasta que borres los datos del sitio. Cerrar sesión no elimina esta preferencia.",
  },
  {
    name: "sidebar_state",
    type: "Cookie funcional",
    purpose: "Guardar el estado abierto o cerrado del menú lateral.",
    duration: "Siete días desde el último cambio del estado del menú, salvo que la elimines antes.",
  },
];

export function CookiePolicy() {
  return (
    <div className="space-y-8">
      <section className="space-y-3" aria-labelledby="cookies-purpose">
        <h2 id="cookies-purpose" className="text-lg font-semibold">1. Qué se guarda y para qué</h2>
        <p className="text-sm leading-7 text-muted-foreground">
          Las cookies son pequeños archivos que el navegador puede enviar al servidor.
          El almacenamiento local guarda datos en tu navegador, pero no los envía automáticamente
          con cada visita. La aplicación utiliza estas tecnologías para identificarte y recordar
          preferencias de la interfaz.
        </p>
        <p className="text-sm leading-7 text-muted-foreground">
          La web principal no incorpora actualmente herramientas de publicidad ni de analítica.
          No se solicita una aceptación de cookies opcionales ni se condiciona el registro a ella.
        </p>
      </section>

      <section className="space-y-4" aria-labelledby="cookies-inventory">
        <h2 id="cookies-inventory" className="text-lg font-semibold">2. Datos utilizados por la web principal</h2>
        <div className="space-y-3">
          {storageItems.map((item) => (
            <section key={item.name} className="rounded-lg border bg-card p-4 sm:p-5">
              <h3 className="font-semibold"><code className="break-all text-sm">{item.name}</code></h3>
              <dl className="mt-3 space-y-3 text-sm leading-6">
                <div><dt className="font-medium">Tipo</dt><dd className="text-muted-foreground">{item.type}</dd></div>
                <div><dt className="font-medium">Finalidad</dt><dd className="text-muted-foreground">{item.purpose}</dd></div>
                <div><dt className="font-medium">Conservación</dt><dd className="text-muted-foreground">{item.duration}</dd></div>
              </dl>
            </section>
          ))}
        </div>
      </section>

      <section className="space-y-3" aria-labelledby="cookies-manage">
        <h2 id="cookies-manage" className="text-lg font-semibold">3. Cómo gestionar o eliminar estos datos</h2>
        <ol className="list-decimal space-y-2 pl-5 text-sm leading-7 text-muted-foreground">
          <li>Para dejar de utilizar tu identificación en este navegador, usa la opción «Cerrar sesión» de la aplicación.</li>
          <li>Para eliminar también las preferencias, abre la configuración de privacidad de tu navegador, busca los datos de este sitio y elimina sus cookies y almacenamiento local.</li>
          <li>Puedes bloquear el almacenamiento desde tu navegador, pero el inicio de sesión y algunas preferencias pueden dejar de funcionar.</li>
        </ol>
        <p className="text-sm leading-7 text-muted-foreground">
          Borrar los datos del navegador no elimina tu cuenta, mensajes ni documentos del servidor.
          Si eliminas el token de acceso, tendrás que identificarte de nuevo.
        </p>
      </section>

      <section className="space-y-3" aria-labelledby="cookies-external">
        <h2 id="cookies-external" className="text-lg font-semibold">4. Servicios externos y cambios</h2>
        <p className="text-sm leading-7 text-muted-foreground">
          Los servicios integrados, como el espacio colaborativo y las videoconferencias,
          pueden utilizar cookies y almacenamiento propios. Su uso depende del proveedor y
          de la configuración de esta instalación. El inventario anterior corresponde
          exclusivamente a la web principal, no al almacenamiento de esos servicios.
          Consulta la política de cookies y privacidad del proveedor al utilizar un servicio externo.
        </p>
        <p className="text-sm leading-7 text-muted-foreground">
          Si se incorporan tecnologías no necesarias, deberá ofrecerse una elección separada
          antes de activarlas, con la posibilidad de rechazarlas y retirar el consentimiento.
          Esta página deberá actualizarse cuando cambien los usos descritos.
        </p>
      </section>
    </div>
  );
}
