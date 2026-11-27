# Grupo AVASA — implementación

## Sitio público
- / Inicio
- /nosotros/ Identidad institucional
- /proyectos/ Proyectos
- /orbitmobile/ Proyecto ORBIT MOBILE
- /boletines/ Comunicados
- /documentos/ Centro documental
- /galeria/ Galería
- /contacto/ Contacto
- /navidad/ Campaña Navidad con el Corazón (se conserva)
- /admin/ AVASA Control
- /empleados/ Portal de colaboradores

## Identidad
Se utiliza el logotipo grupo-avasa.png del repositorio y la paleta institucional guinda, dorado y crema: #681331, #41091f, #c2a06a, #f6f1e8.

## Datos y acceso
La hoja de cálculo existente se conecta mediante el ID configurado en Code.gs. Las cuentas y los hashes de contraseña con sal se almacenan en la pestaña Accesos_Sistema de Google Sheets. No se guarda la contraseña en texto plano ni en propiedades de Apps Script. Apps Script ejecuta la validación y conserva tokens de sesión temporales en caché.

Roles:
- ADMIN: control total, cuentas, configuración y auditoría.
- RH: gestión de empleados.
- EDITOR: edición de contenido público.
- EMPLOYEE: acceso al portal de colaboradores y a su perfil.

## Activación en Apps Script
Los archivos del directorio apps-script/ son el código fuente. Para que la implementación publicada los utilice, hay que sincronizarlos una vez en el proyecto de Apps Script vinculado al despliegue:
1. Reemplazar el contenido de Code.gs con apps-script/Code.gs.
2. Reemplazar el HTML que ya existe (puede llamarse index) con apps-script/Index.html. El código admite tanto Index como index.
3. Crear un archivo HTML nuevo llamado Empleados y pegar apps-script/Empleados.html.
4. Guardar y ejecutar una vez inicializarEstructura() para crear las pestañas que falten. No borra pestañas ni usuarios existentes.
5. En Deploy → Manage deployments → Edit → New version → Deploy, publicar la nueva versión. Mantener el mismo deployment URL para que los enlaces /admin/ y /empleados/ sigan apuntando al mismo proyecto.

No ejecutar crearAdministradorInicial() si ya existe una cuenta en Accesos_Sistema.

## Pestañas de contenido
Accesos_Sistema, Boletines, Documentos, Galeria, Proyectos, Estadisticas, Empleados, Paginas e Historial. Las estadísticas se publican en la web solo cuando la casilla publico está activada.

## Nota de seguridad
Las contraseñas se almacenan como hash con sal, nunca en texto plano. Restringe los permisos de edición de la hoja de cálculo a administradores autorizados. Apps Script y Google Sheets son la capa de datos; el navegador no recibe la hoja completa ni los hashes.
