# M9.0 — Wallet, transaction, security, product and legal gate

Fecha de evaluación: 12 de septiembre de 2026. Proyecto: Ansem Frontline. Jurisdicción considerada: España / Unión Europea.

## 1. Decisión y alcance

**Recomendación principal: OPTION A — NO WALLET, por ahora. Confidence: HIGH para esta secuencia de producto.** Priorizar Battlefield Motion / Combat / Commander Profiles antes de cualquier implementación wallet. Conservar OPTION B, verificación puntual de una compra externa, como candidata a un gate posterior; no queda aprobada para implementar.

Frontline ya puede ofrecer visualización de mercado y personalización B2B sin gestionar la interacción transaccional del visitante. No hay evidencia de demanda, conversión o ingresos que justifique hoy añadir autenticación de wallet, un verificador con estado persistente y obligaciones operativas. La confianza en ingresos futuros es LOW: las puntuaciones de producto son hipótesis, no resultados de experimentos. La recomendación no significa que una wallet sea intrínsecamente inadecuada, sino que su coste y riesgo incremental todavía no están justificados.

Este documento es investigación, arquitectura conceptual, threat model y registro de decisión. No autoriza dependencias, UI, connect, firmas, construcción/envío de transacciones, endpoints, almacenamiento de direcciones, cuentas ni activación verified. No constituye asesoramiento jurídico ni afirma que Frontline esté autorizado, exento o sujeto necesariamente a una licencia.

M8 production queda fuera de alcance. No se requiere ni se realiza push, PR, merge o deploy. Los diseños de las secciones 6–13 son condiciones para una posible arquitectura futura, no descripción de funcionalidades existentes.

## 2. Baseline y límites existentes

| Comprobación inicial | Resultado |
| --- | --- |
| Rama | `feat/m9-wallet-security-gate` |
| HEAD, main y origin/main locales | `fa3f839a43f5b666b7a12999635c0d92e49416f2` |
| Working tree | Limpio |
| `git diff main..HEAD` | Vacío |
| Dependencia runtime | Solo `three`, versión `0.185.1` |
| Desarrollo | Vite, Vitest, Playwright, ESLint, globals, Wrangler y tipos Cloudflare |
| Wallet / Jupiter / signing / wallet UI M9 | Sin implementación ni paquetes añadidos |
| Documentación existente | `user-champion.md`, `theme-engine.md`, `theme-studio.md`; sin estructura ADR separada |

El baseline se refiere a referencias locales comprobadas, no a una nueva auditoría de producción. La presencia de firmas de transacciones en el pipeline read-only no equivale a disponer de signing ni autenticación wallet.

La arquitectura M8 documenta un Champion temporal, por mint, con fuentes `simulation` y `test`; la política actual rechaza otras fuentes. Su estado reside en memoria, no es prueba económica. El hook de simulación está restringido a desarrollo/test. `ChampionController` es autoridad del estado de presentación M8, **no autoridad de elegibilidad económica**. La sanitización de snapshots y la secuencia monotónica de `champion-sync.js` no autentican criptográficamente al emisor de BroadcastChannel.

Estos límites se conservan. Este gate no certifica exhaustivamente todos los componentes históricos del mercado ni convierte datos agregados de un proveedor en pruebas on-chain de compras individuales.

## 3. Integridad del mercado

### MARKET REALITY IS THE SOURCE OF TRUTH

```text
Real Market Data
      -> Canonical Market State
           -> Battle State
                -> Visual Behaviour
```

Trades, precio, volumen, presión compradora/vendedora, pools, liquidez, flujo de transacciones y cualquier métrica publicada deben proceder de fuentes reales identificables. Market cap solo se muestra cuando precio y oferta permiten un cálculo fiable; FDV no se etiqueta como circulating market cap. Cada dato necesita procedencia, unidad, ventana temporal y frescura. Ausencia de datos significa desconocido/degradado, no cero confirmado ni actividad inventada.

Es admisible interpolar una trayectoria, variar una pose o dramatizar un impacto para representar un evento real. No es admisible inventar un trade, un holder, liquidez o presión porque la escena esté quieta. La aleatoriedad cosmética no escribe métricas canónicas, no crea unidades que se presenten como nuevos trades y no se utiliza como evidencia de mercado. Los efectos de combate son una metáfora visual, no una segunda fuente de precios o volúmenes.

Para una compra real del propio usuario existen dos consecuencias independientes:

```text
Compra real en Solana
  +-> feed normal -> normalización/deduplicación -> mercado -> batalla
  |
  +-> verificación independiente -> elegibilidad -> User Champion cosmético
                                       X
                              sin escritura al mercado
```

No hay synthetic buy, multiplicador por usuario, bonus de fuerza ni inserción del trade desde el verificador. Si la verificación llega antes que el feed, puede existir Champion sin un nuevo evento visual de mercado; no se rellena el retraso artificialmente. Si llega después, no se repite el impacto. El feed puede registrar una compra que no sea elegible; también puede faltar temporalmente una compra verificada. No se fuerza equivalencia entre ambos estados.

La deduplicación del feed necesita una identidad acorde a su granularidad, por ejemplo red + firma + índice de evento/instrucción normalizado + mint. Una firma puede contener varias patas; ni duplicar todos los hops como compras del usuario ni eliminar operaciones legítimas distintas por usar únicamente la firma. No sumar estadísticas agregadas y trades individuales como si fueran conjuntos disjuntos sin una regla explícita de reconciliación.

## 4. Ecosistema oficial actual

### 4.1 Solana y Wallet Standard

La documentación frontend actual recomienda `@solana/kit` y plugins, incluido `@solana/kit-plugin-wallet` para descubrimiento Wallet Standard. React tiene bindings opcionales; no hay motivo arquitectónico para migrar esta aplicación vanilla/Vite a React. La guía de migración presenta web3.js v1 y wallet-adapter como legado, y el anterior framework-kit como sustituido por el stack de plugins. La compatibilidad web3.js v3 se describe como puente en RC, no como requisito de este proyecto.[^1][^2]

Wallet Standard ofrece registro/descubrimiento por eventos y contratos de wallet/cuenta. Las capacidades se comprueban por wallet **y cuenta**, no por nombre o icono: conexión, eventos de cambio, desconexión cuando esté disponible, `solana:signMessage`, `solana:signTransaction` y `solana:signAndSendTransaction` tienen funciones distintas. Firmar una transacción no implica enviarla; connect no prueba control ante nuestro servidor. Las versiones de transacción admitidas deben negociarse y las desconocidas rechazarse.[^3][^4]

Diseño futuro: suscribirse antes de conectar, manejar registro tardío, selección explícita de cuenta, cambio de cuentas/chains/features, lock y desconexión. No asumir `accounts[0]` como identidad estable. No autodisparar firmas al reconectar. Si falta la capacidad requerida, ofrecer read-only, no un fallback transaccional para demostrar identidad.

| Wallet | Evidencia oficial y límite | Política interoperable propuesta |
| --- | --- | --- |
| Phantom | Declara soporte Wallet Standard; documenta firma de mensajes.[^5][^6] | Descubrimiento estándar, no dependencia exclusiva de `window.phantom`; probar extensión y navegador móvil por separado. |
| Solflare | Su documentación incluye SDK/adaptador y un flujo móvil SignMessage con mensaje visible.[^7][^8] | Preferir capacidades estándar descubiertas; no copiar el tutorial específico como arquitectura obligatoria. |
| Backpack | Documenta métodos connect/disconnect/sign y universal links móviles; sus sesiones deeplink no expiran automáticamente.[^9][^10] | No heredar esa duración como autenticación Frontline. Capability tests de extensión y móvil antes de prometer soporte. |

La guía Solana incluye Phantom, Solflare y Backpack en el enfoque Wallet Standard.[^2] Esto respalda una arquitectura interoperable, no garantiza paridad de versiones, hardware wallets o navegadores. Las páginas móviles no prueban por sí mismas las capacidades de la extensión. La matriz real de compatibilidad permanece pendiente; no se conectó ninguna wallet durante M9.0.

### 4.2 Confirmación, simulación y testing

`processed` puede revertirse; `confirmed` tiene voto de supermayoría; `finalized` es el nivel más fuerte expuesto. La red se selecciona por endpoint, no por el texto que envíe el navegador. Los RPC públicos compartidos no se recomiendan como infraestructura de producción.[^11] **Decisión de diseño:** las elegibilidades futuras esperan `finalized`; los estados anteriores solo permiten mostrar pendiente.

Una transacción contiene mensaje y firmas. La validez de un recent blockhash es limitada; hay que usar la información de altura/validez, no un temporizador fijo universal. Cambiar el mensaje exige nuevas firmas. Un timeout de envío no demuestra que la transacción no se ejecutó.[^12]

`simulateTransaction` permite inspeccionar ejecución sin broadcast; puede operar sin firmas cuando no se solicita su verificación. Sustituir blockhash en simulación no renueva una transacción firmada.[^13] **Interpretación técnica:** simulación favorable no garantiza ejecución, seguridad económica ni finality; en rutas RFQ con firma posterior puede no reproducir todo el flujo. Esa limitación requiere política explícita, no omitir validación silenciosamente.

`getTransaction` aporta slot, versión, metadata y tiempo de bloque potencialmente nulo; puede devolver null. Los metadatos de instrucciones y balances requieren interpretación, no basta con que exista una firma.[^14] Las guías oficiales incluyen LiteSVM para pruebas locales; RPC documenta devnet y herramientas locales.[^15][^11] Propuesta de tests en sección 13: fixtures deterministas y wallets simuladas en CI, integración local/devnet, compatibilidad manual; nunca claves/fondos reales en CI.

### 4.3 Jupiter: versión y límites

La API recomendada consultada es **Swap V2**, base `https://api.jup.ag/swap/v2`. Meta-Aggregator usa `/order` + `/execute` y transacción ensamblada; compiten Metis, JupiterZ, Dflow y OKX. Router usa `/build` para instrucciones y landing propio o `/submit`; ofrece control adicional y no usa JupiterZ. La recomendación oficial general es Meta-Aggregator. Las transacciones de `/order` no son modificables.[^16]

`/order` combina quote y transacción; sin taker no devuelve transacción. Una transacción vacía puede acompañar a una cotización: no es ejecutable. Se firma y se entrega a `/execute` junto con `requestId`; JupiterZ puede requerir firma posterior del market maker. Agregadores utilizan `lastValidBlockHeight`; RFQ utiliza `expireAt`. `status`, firma y códigos deben interpretarse por router; una firma puede aparecer también en fallos. Los importes netos y de ruta son distintos. Las comisiones totales pueden diferir de la comisión de plataforma; existen referrals. Los valores y condiciones deben releerse al diseñar.[^17]

RTSE estima slippage automáticamente en `/order`; `/build` permite solicitarlo. No es garantía de precio.[^18] Las capacidades de landing/MEV anunciadas por Jupiter son mitigaciones del proveedor, no inmunidad contractual/técnica a MEV, censura o ejecución adversa.[^19] Este gate no adopta cifras de ahorro ni pruebas comerciales de mejor precio.

Hay una discrepancia documental: overview dice API key en todos los endpoints; Portal permite keyless a 0,5 RPS y recomienda clave para producción.[^16][^20] No se ha probado acceso operativo. **Decisión:** ninguna dependencia de acceso anónimo; si D se reabre, confirmar contrato, límites, región y versión, y mantener cualquier clave de servicio fuera del bundle. No registrar claves ni copiar ejemplos que cargan private keys.

Metis Swap API v1 aparece como no mantenida activamente y sustituida por V2.[^21] No diseñar contra `/swap/v1`, `/ultra/v1` o Lite API por tutoriales antiguos; `mode: ultra` dentro de V2 no significa usar la API Ultra legacy. El índice actual identifica V2 como reemplazo para esos flujos.[^19]

## 5. Opciones de producto y decisión

| Opción | Qué hace Frontline | Qué no hace | Valor y coste principal |
| --- | --- | --- | --- |
| A — No wallet | Visualiza mercado real y mantiene separación cosmética. | No identifica wallet ni vincula Champion a compras. | Mejor reversibilidad y foco; posterga interacción verificada B2C. |
| B — Control + observación puntual | Autentica control de una dirección y verifica una transacción externa indicada voluntariamente. | No prepara, cotiza, transmite ni ejecuta órdenes; no observa toda la cartera. | Champion real con menor superficie transaccional, pero requiere backend, estado antirreplay y privacidad. |
| C — Navegación externa + verificación | Facilita salida a un proveedor y, opcionalmente, la verificación B. | No construye ni envía la transacción. | Mejor descubrimiento del flujo; más riesgo de atribución, promoción, parámetros y dependencia del proveedor. |
| D — Swap integrado | Solicita orden, presenta condiciones, pide firma y facilita envío/ejecución. | Nunca custodia claves ni decide operaciones sin consentimiento. | UX integrada con máxima complejidad de seguridad, soporte y clasificación regulatoria. |

### Matriz comparativa

Escala 1–5, **5 siempre más favorable**. En complejidad/riesgos/incertidumbre/mantenimiento, 5 significa menor carga. Juicio de arquitectura para este repositorio, no medición comercial ni probabilidad legal. Pesos explícitos; promedio ponderado = suma(peso × puntuación)/100.

| Criterio | Peso | A | B | C | D |
| --- | ---: | ---: | ---: | ---: | ---: |
| Valor de producto incremental | 15 | 2 | 4 | 4 | 5 |
| UX global, incluidos errores | 10 | 4 | 3 | 3 | 3 |
| Baja complejidad de ingeniería | 10 | 5 | 3 | 2 | 1 |
| Bajo riesgo de seguridad | 15 | 5 | 3 | 2 | 1 |
| Bajo riesgo de privacidad | 10 | 5 | 3 | 2 | 1 |
| Baja incertidumbre regulatoria incremental | 15 | 5 | 3 | 2 | 1 |
| Bajo mantenimiento | 10 | 5 | 3 | 2 | 1 |
| Calidad de portfolio | 5 | 4 | 5 | 3 | 3 |
| Potencial monetización alineada | 5 | 4 | 4 | 4 | 4 |
| Reversibilidad | 5 | 5 | 3 | 3 | 1 |
| Resultado ponderado / 5 | 100 | **4,35** | **3,30** | **2,60** | **2,05** |

Una gran demanda validada de interacción B2C podría elevar B y cambiar los pesos. No elimina los gates esenciales: ninguna media compensa un NO-GO legal o de seguridad. No se presume que A carezca de obligaciones por publicidad, datos de mercado, contratos o privacidad existente.

**Razones para A:** permite demostrar valor y calidad visual antes de administrar identidad económica; favorece personalización B2B; mantiene bajo el coste de reversión. Su coste de oportunidad es aplazar la experiencia de Champion ganado mediante compra. La arquitectura M8 conserva el punto de extensión sin obligar a usarlo.

**B queda como alternativa futura**, de alcance estricto: una reclamación voluntaria sobre transacción reciente, sin escucha continua de holdings, historial o actividad. Coste relativo MEDIUM/HIGH frente a A: varios módulos nuevos, operación persistente y revisión externa; no es un botón de wallet. C añade responsabilidad de navegación y relación comercial sobre B. D exige un programa de seguridad transaccional y revisión legal sustancialmente mayor; no se recomienda para la siguiente fase. No se estiman jornadas ni presupuesto sin especificación y revisión humana.

### Dónde termina la responsabilidad en C

Propuesta mínima: una salida explícita a dominio HTTPS fijo aprobado, mostrando el proveedor; opcionalmente mint público/red, sin cantidad, wallet, sesión, firma, auth ni referencia individual en URL. Destino no derivado de metadata arbitraria; prevenir open redirect, usar `noopener` y política de referrer adecuada. No iframe que confunda quién presta el servicio. El usuario elige y aprueba la operación en el sitio externo.

Frontline seguiría siendo responsable de su enlace, parámetros, afirmaciones, relación de afiliación y posterior verificación. El proveedor sería responsable de su flujo, pero esa separación técnica no resuelve automáticamente el reparto jurídico. Un enlace genérico no es equivalente a preconfigurar una instrucción de compra; seleccionar una ruta, imponer importe, cobrar referral o pasar una orden requiere reabrir clasificación. Un callback externo jamás acredita compra. No se ha comprobado la autorización MiCA de ninguna entidad operadora de Jupiter: disponibilidad técnica no equivale a habilitación para prestar servicios en España.

## 6. Trust boundaries conceptuales

Todo componente marcado FUTURO está ausente y no se crea en M9.0.

```text
DISPOSITIVO DEL USUARIO — entorno modificable
 Browser
   +-- Frontline frontend <---- capacidades/firma ----> Wallet/extension
   |        |                                             |
   |        | B: challenge + prueba + claim                | claves permanecen aquí
   |        v                                             |
   |   [frontera HTTPS / sesión / origen]                  |
   |        |                                             |
   |        v                                             |
   | Frontline verification backend [FUTURO]               |
   |   +-- auth/challenge                                 |
   |   +-- verifier <-- RPC/provider(s) <-- Solana network |
   |   +-- atomic claims + eligibility + policy            |
   |        |                                             |
   |        +--> recibo acotado --> ChampionController     |
   |                                  --> presentación    |
   |
   +-- D solamente [FUTURO, NO aprobado]:
        frontend <-> order gateway <-> Jupiter/provider
              firma de wallet -> execute -> Solana network
              resultado -> verificador independiente anterior

PIPELINE INDEPENDIENTE EXISTENTE
 proveedores reales -> validación de mercado -> estado canónico -> batalla
 verificador/Champion ----X----> no emiten eventos de mercado
```

**CLIENT IS NOT AUTHORITATIVE FOR ELIGIBILITY.** Browser, wallet anunciada, parámetros del usuario, localStorage, query params, snapshots y callbacks son entradas no confiables. La wallet puede demostrar control criptográfico de una clave; no certifica identidad civil, compra, precio ni entitlement. El backend autentica y clasifica evidencia, aplicando una política versionada; RPC es proveedor de observaciones, no autoridad de producto. Solana acredita ejecución bajo sus reglas, no la calificación económica BUY ni la persona beneficiaria.

El backend hipotético puede alojarse en Cloudflare, pero el Worker actual de mercado no adquiere autoridad wallet por estar en el mismo proveedor. Aislar módulos, secretos, cuotas y despliegue, aunque se comparta infraestructura. La seguridad de sesión no se resuelve con CORS: validar origen, CSRF, cookies seguras y autorizaciones. PiP/Pixel reciben solo una proyección sanitizada sin dirección, firma ni pruebas.

Un usuario puede alterar su propia pantalla. No se promete impedir un Champion dibujado mediante DevTools. La garantía buscada es que esa alteración no produzca un grant en servidor, una reclamación transferible ni impacto de mercado para otros usuarios.

## 7. Prueba de control de wallet, conceptual

Propuesta inicial para B: una cuenta explícita, una red, un mint y una transacción propuesta por reclamación. Prueba de control actual, **no prueba de titularidad jurídica ni de identidad única**. Sin seed phrase, private key, export key, aprobaciones de gasto o transacciones de autenticación.

1. El usuario solicita voluntariamente verificar una compra e identifica cuenta y firma candidata. El servidor valida formato y límites antes de consultar proveedores. No se conecta al abrir la página.
2. El servidor crea challenge de un solo uso con nonce criptográficamente aleatorio de al menos 128 bits, ID único, versión, propósito, dominio/origen HTTPS exactos autorizados, cadena, cuenta, mint canónico, firma candidata, referencia opaca de sesión, issuedAt y expiresAt.
3. Se presenta un mensaje legible y con serialización inequívoca: demostrar control para verificar esa compra/Champion; no autoriza transferencias. No firmar bytes opacos, HTML, mensajes reutilizados de otros dominios ni serialización de transacciones disfrazada. Preferir un formato de sign-in estándar compatible tras revisión; no inventar criptografía.
4. Se solicita exclusivamente la capacidad de firma de mensaje para esa cuenta. Se comprueban los bytes efectivamente firmados, firma y public key en servidor contra el challenge almacenado. La respuesta de wallet no puede reemplazar dominio, cuenta o mensaje esperado.
5. Verificación y consumo del challenge son atómicos; se rota la sesión para evitar fijación. Reintentos idénticos recuperan el mismo resultado solo para la misma sesión, sin crear otra autenticación. Rate limits por varias dimensiones y respuestas no enumerables.
6. Cuenta/red cambiada, lock, disconnect o pérdida de autorización cancelan solicitudes y ocultan la presentación asociada; se revoca la sesión en servidor. Respuestas tardías llevan una generación/identidad de contexto y se descartan. Si el cliente no puede notificar desconexión, expiración corta limita el riesgo; no se presume revocación mágica de cookies.

Parámetros de partida para revisar, **no plazos legales ni política publicada**: challenge 5 minutos; sesión sin renovación silenciosa 15 minutos; reclamación de compra de hasta 10 minutos con desfase máximo de reloj acordado, por ejemplo 60 segundos. El challenge se vincula a la firma concreta para evitar que un mensaje genérico autorice exploración posterior de historial. Multi-account requiere selección y challenge nuevos. No reutilizar un nonce entre redes, mints o sitios.

Si una hardware wallet no puede firmar el mensaje requerido, no hay autenticación B en esa combinación. No pedir una transferencia de importe cero como alternativa. Firma robada fuera del contexto falla por dominio/sesión/cuenta/mint/tx/nonce/expiración. Un navegador comprometido sigue siendo un riesgo residual; la firma no corrige XSS.

## 8. Verificación de una compra real

Contrato de entrada mínimo: claim ID idempotente, sesión autenticada, firma candidata y mint esperado vinculado al challenge. Importe, dirección BUY, timestamp o identidad aportados por frontend son afirmaciones a comprobar, no hechos.

Secuencia conceptual del verificador:

1. Configuración de red fijada en servidor, validación de endpoint/genesis y credenciales; nunca RPC URL arbitraria del usuario. Obtener transacción y metadata completas con versión soportada y `finalized` explícito. `null`, metadata ausente, estado no definitivo o datos contradictorios: pendiente/acotado o no verificable, nunca aprobado por timeout.
2. Comprobar firma identificadora, bytes/mensaje, ausencia de error y cuenta autenticada en las firmas/autorizaciones relevantes. Ser fee payer o mero firmante incidental no basta. Para el primer alcance, exigir la cuenta como firmante y propietaria económica de cuentas token de entrada/salida; excluir delegación, multisig, program wallets y custodial exchange withdrawals no soportados.
3. Resolver account keys y address lookup tables de transacciones versionadas; interpretar instrucciones principales, CPI/inner instructions y programas token admitidos. No confiar únicamente en nombres de programas, logs o un parser de tercero. Versiones/programas sin soporte explícito: rechazar elegibilidad, no todo el sitio read-only.
4. Identificar cuentas token y propietarios **en el contexto de esa transacción**. Agregar deltas enteros en unidades base de las cuentas pertinentes de la cuenta autenticada, incluyendo cuentas creadas/cerradas. No aplicar indiscriminadamente el owner actual a una operación histórica. Si no puede reconstruirse evidencia de propiedad, no aprobar.
5. Mint de salida exactamente igual al canónico; token program/decimals contrastados. Determinar cantidad neta recibida y contraprestación real gastada. Distinguir SOL/WSOL, wrapping/unwrapping, rent y network fees del precio pagado. No utilizar floats ni `uiAmount` redondeado como autoridad.
6. Clasificar BUY únicamente cuando una ruta de intercambio soportada une contraprestación y adquisición. Un delta positivo aislado puede ser regalo, airdrop, mint, retirada de LP, transferencia interna o devolución de préstamo. Excluirlos. Un swap multi-hop/split debe colapsarse a un intercambio económico del usuario, no premiar cada pata. Mezclas ambiguas de transferencias y swaps se rechazan aunque el usuario haya comprado algo.
7. Validar ventana contra tiempo/slot de evidencia y reloj del servidor, no timestamp del navegador. Si `blockTime` es nulo, exigir evidencia temporal alternativa definida y verificada; en el alcance inicial, no admitir ese claim. Verificar compra posterior al inicio de la ventana permitida y no en el futuro fuera del desfase tolerado.
8. Aplicar política de monto mínimo y programa/mint elegible solo si producto y revisión legal la aprueban. Valor por defecto conceptual: no recomendar importes ni incentivar compras sucesivas; no usar USD estimado sin fuente temporal verificable. Rechazar wash/circular patterns detectables, sin afirmar resolver Sybil o intención económica.
9. Persistir consumo atómico y elegibilidad en una única operación lógica antes de emitir resultado. El servidor es autoridad del doble claim; no delegar esta decisión al controller ni al cliente.

La política de inicio debe ser una allowlist pequeña de rutas y comportamientos verificables, aunque Frontline visualice CAs arbitrarias. **Visualizable no significa verificable y verificable no significa seguro para comprar.** Un parser de swaps necesita corpus real de casos complejos y revisión independiente; no se escribe en M9.0.

## 9. Champion, replay e idempotencia

```text
VerifiedEligibility [solo servidor]
  -> ChampionActivationRequest [recibo autorizado, no callback]
       -> ChampionPolicy [reglas aprobadas, tiempo del servidor]
            -> ChampionController [estado de presentación]
```

Campos conceptuales internos: schemaVersion, grantId, chain, canonicalMint, opaqueSubject, claimKey, evidenceSlot, verifiedAt, expiresAt, policyVersion y status. La evidencia de cantidad/owner permanece interna y solo mientras sea necesaria. Para recuperación tras reautenticación, opaqueSubject puede ser un HMAC de cuenta/red limitado al lifetime del grant, sin directorio permanente de identidades; sigue siendo dato pseudónimo. El cliente recibe grantId, mint, expiración y presentación autorizada mediante sesión segura; si hay recibo firmado, debe ligar issuer/audience/sesión y no convertirse en bearer transferible. Ningún consumidor externo acepta un snapshot del browser como recibo.

`source: verified` requeriría un contrato distinto, cerrado y autenticado. No basta añadir un string al enum M8. `simulation/test` no pueden promoverse, ni siquiera si contienen un grantId aparentemente válido. El controller conserva su límite por mint y su falta de acceso al mercado. El servidor fija duración y expiración; refresh/reconnect no reinician el reloj. La duración M8 de 30 minutos no constituye decisión automática para Champion verificado.

| Caso | Autoridad y resultado requerido |
| --- | --- |
| Misma firma / duplicate request | Reserva/consumo atómico global; mismo resultado para el propietario del claim, nunca grant nuevo. |
| Dos tabs / instancias backend simultáneas | Una restricción única en almacén con consistencia fuerte; Map, localStorage y KV eventualmente consistente no bastan. |
| Refresh / reconnect | Recuperar grant no expirado tras autorización válida; no prolongarlo ni consumir otra vez. |
| Cross-token | Claim ligado al mint; consumo global por transacción para la clase de entitlement evita reclamar otra pata con otro mint. |
| Cross-session | Nuevo challenge no borra consumo. Recuperación solo tras autenticar misma cuenta y comprobar binding; sin duplicar grant. |
| Firma copiada de otra wallet | Falla prueba de control o relación signer/owner de entrada/salida. Publicidad de la firma no da derecho. |
| Reorg / RPC inconsistente | No aprobar antes de finality; ante contradicción detener grants, investigar y poder revocar proyección. Finality no equivale a garantía absoluta ante compromiso sistémico. |
| Crash tras consumo, antes de respuesta | Grant y consumo se guardan juntos; retry recupera el resultado original con expiry original. |
| Borrado/rotación/actualización de policy | No reabrir firma consumida: la namespace antirreplay no cambia con session, mint ni policyVersion. |

Clave antirreplay propuesta: HMAC de `chain + transactionSignature + entitlementClass`. Un único Champion por transacción para esa clase, aunque haya varias compras en ella. Esta restricción es deliberada para minimizar ambigüedad. No incluye sesión ni mint como separación de unicidad. Una futura ampliación exige migración de claims, no simplemente otra clave.

Propuesta operativa a aprobar: retain spent-claim marker 24 horas, holgadamente más que ventana de 10 minutos + desfase + retries acotados. Un claim pendiente solo puede finalizar dentro de esa misma ventana; pasada, se cierra. Rotación HMAC requiere overlap/consulta de claves anteriores hasta que caduquen todos los claims relevantes. Restauración de backup o pérdida del almacén: suspender grants al menos hasta poder garantizar que ninguna transacción previamente elegible sigue en ventana; nunca reiniciar con memoria vacía y seguir aceptando históricos. El marcador sigue siendo pseudónimo, no anónimo.

## 10. Terceros y fallo seguro

| Tercero | Datos / autoridad real | Validación propuesta | Outage / compromiso / fallback |
| --- | --- | --- | --- |
| Wallet extension | Cuentas/capacidades/firmas; controla la interacción con claves, no eligibility. | Cuenta seleccionada, bytes firmados, verificación servidor, versiones admitidas. | Cancelar/volver read-only; un nombre conocido no prueba autenticidad. No cambiar automáticamente a otro provider. |
| RPC/provider | Estado, tx y metadata según nodo; observación de cadena. | Red/genesis, finality, slot, esquema, firmas y semántica; proveedor secundario independiente ante duda. | Espera acotada; divergencia bloquea claim. No mayoría simple entre endpoints del mismo operador ni downgrade a processed. |
| Jupiter/provider, solo D | Quote, tx ensamblada, landing/status; no entitlement ni garantía de seguridad. | Binding a intención, decode/allowlist/fees, mensaje inmutable, verificación on-chain posterior. | Deshabilitar swap; no fallback silencioso a API legacy o ruta pública que cambie privacidad/MEV. |
| Token metadata | Nombre, símbolo, imagen y URI; ninguna identidad canónica ni seguridad. | Mint/token program on-chain; strings acotados y texto seguro; URL schemes permitidos. | Etiqueta mint abreviada, metadata desconocida. No HTML, script, enlaces wallet ni perfil comandante elegido por metadata. |
| Price/market provider | Trades y agregados, con cobertura y ventanas propias. | Procedencia, frescura, normalización/dedupe; fuentes alternas comparables sin mezclar métricas. | Estado stale/unknown visible; no inventar actividad, precio o market cap para rellenar. |
| Cloudflare Worker / hosting | Código y transporte propios; futuro backend tendría autoridad solo por diseño explícito. | Acceso administrativo, secretos separados, rate limits, redacción logs, despliegues revisados. | Kill switch claims/swap preservando read-only; compromiso requiere revocación, rotación y respuesta a incidentes. |

Dos RPC independientes reducen ciertos errores, pero no convierten JSON en prueba trustless. Un verificador operado por Frontline sigue siendo un punto de confianza. No diseñar una red de validadores propia para un entitlement cosmético; si no se puede aceptar el riesgo residual del modelo pequeño, mantener A.

## 11. Threat model

Activos: fondos y consentimiento del usuario, integridad de grants/mercado, privacidad, claves de servicio y reputación. Adversarios: sitio clonado, script XSS, extensión maliciosa, cliente modificado, proveedor comprometido, token/programa hostil y reclamante abusivo. Los controles siguientes son requisitos futuros, **no controles implementados ni auditados**. D tiene mayor impacto financiero; B no queda libre de phishing o exposición de datos.

| Threat | Impacto | Frontera | Mitigación requerida | Riesgo residual |
| --- | --- | --- | --- | --- |
| Provider inyectado malicioso | Cuenta o firma falsa, phishing | Browser ↔ wallet | Selección explícita, verificar pruebas, no confiar en marca/capability anunciada | El dispositivo puede estar comprometido |
| Extensión comprometida | Firma engañosa o robo de fondos | Wallet ↔ usuario | Nunca manejar claves; mensajes claros; pruebas de integración y recomendaciones prudentes | Frontline no puede sanear una extensión |
| Account switch / respuesta tardía | Grant/orden para otra cuenta | Wallet ↔ sesión | Binding cuenta/red/mint/generación; cancelar pendientes, reautenticar | Evento omitido exige expiración y checks servidor |
| Petición de firma phishing | Consentimiento engañado | UI ↔ wallet | Propósito legible, sin instrucciones financieras, sin auto-prompts | Un clon puede copiar la apariencia |
| Message ambiguity | Firma reutilizable con otro significado | Mensaje ↔ verifier | Serialización canónica, versión/dominio/propósito explícitos | Auditoría del formato pendiente |
| Origin confusion | Autenticación desde sitio ajeno | HTTPS ↔ sesión | Orígenes exactos, sin wildcard preview, CSRF y challenge servidor | DNS/hosting comprometido |
| Signature replay | Grants múltiples | Cliente ↔ backend | Nonce único, expiración, consumo atómico, key global de tx | Pérdida del almacén requiere cierre seguro |
| Transaction substitution | Firma de otra operación | Jupiter ↔ frontend ↔ wallet | Decodificar y ligar mensaje completo; verificar bytes tras firma | Parser o dependencias vulnerables |
| Mint substitution | Compra del activo equivocado | Metadata/quote ↔ intención | Mint canónico y token program, nunca ticker como identidad | Usuario puede confundir mints visualmente |
| Amount substitution | Gasto excesivo | UI ↔ orden | Enteros base, límites aprobados, mensaje/importe vinculados | UI comprometida puede engañar |
| Stale quote | Precio/condiciones ya inválidos | Quote ↔ firma | Expiry por ruta, margen de firma, nuevo resumen al requote | Mercado cambia durante firma |
| Slippage manipulation | Peor resultado tolerado | Parámetros ↔ instrucciones | Cap de producto, comprobar mínimo on-chain, no elevar automáticamente | Pérdida dentro del límite consentido |
| Fee manipulation | Cobros inesperados | Proveedor ↔ mensaje | Desglose y límites de fees/rent/tips, cuenta receptora validada | Costes variables y fallos con network fee |
| Programa/account metas hostiles | Transferencias o autorizaciones ajenas | Tx ↔ Solana | Allowlist, resolver LUT/CPI, rechazar approve/setAuthority/transfer extra no esperado | Upgrades o exploits en programas permitidos |
| RPC inconsistente | Compra falsa o finality incorrecta | Nodo ↔ verifier | Red/slot/semántica, corroboración independiente, fail closed | Colusión o fallo sistémico |
| Provider outage / rate limit | UX bloqueada, retries peligrosos | Servicios externos | Timeouts/retry budget, circuit breaker, estado pendiente/read-only | Disponibilidad menor que una UI optimista |
| API key leakage | Abuso, costes y acceso a servicios | Backend ↔ proveedor | Secrets server-only, scopes y cuotas mínimas, rotación; sin VITE_* secreto | Compromiso del backend/operador |
| XSS / supply chain | Robo de sesión, sustitución de intención | Datos/dependencias ↔ browser | Texto seguro, CSP, dependencias mínimas, revisión lockfile, no third-party scripts de signing | CSP no protege de todo código confiable comprometido |
| CSP relajada | Más exfiltración/ejecución | Política browser ↔ recursos | Revisar allowlist mínima por host; no unsafe-eval ni comodines nuevos para wallet | Extensiones operan fuera de parte del control CSP |
| Clickjacking | Aprobación engañada | Sitio padre ↔ UI | frame-ancestors none y prueba en cada hosting; no wallet UI en embeds | Popup/overlay del dispositivo ajeno al sitio |
| Duplicate submission | Dos operaciones diferentes tras retry | App ↔ execute | Mismo requestId/mensaje para intento; reconciliar firma antes de crear otra orden | Respuesta de envío perdida requiere estado desconocido |
| Blockhash expiration | Fallo o doble compra al recrear | Firma ↔ cadena | Verificar altura/status; nuevo consentimiento si cambia mensaje | La operación anterior puede haberse ejecutado antes de expirar |
| Token económico malicioso | Fondos bloqueados/pérdida | Mint/programa ↔ usuario | Política de soporte, warnings verificables y denylist de comportamientos no soportados | No existe detector universal de scams |
| Sybil / wash trading | Farming de Champion y presión social | Identidad ↔ política | No premiar frecuencia/volumen; límites de grant; sin ventajas de mercado | Varias wallets no equivalen a varias personas |
| Fuga por logs/analytics | Perfil financiero identificable | Browser/backend ↔ terceros | Redacción de URLs/cuerpos, no wallet analytics; revisión contractual | Terceros pueden conservar datos propios |

La CSP local en `vercel.json` ya declara `script-src 'self'`, `object-src 'none'` y `frame-ancestors 'none'`, pero permite conexiones `*.workers.dev` y imágenes HTTPS amplias. No se considera suficiente una revisión estática ni se certifica que todos los hostings apliquen esos headers. Cualquier wallet futura requiere revisar CSP real por origen/entorno, sin modificarla ahora.

## 12. Requisitos especiales si se reabre D

D es NO-GO actualmente. Si se reconsidera, comenzar por una única red, cuenta seleccionada como destinataria, rutas soportadas y ExactIn; excluir transferencias a terceros, patrocinio con clave propia, órdenes persistentes y batch trading del alcance inicial. Un gateway no custodial protege API keys y aplica políticas; por facilitar ejecución, aumenta responsabilidades y no sustituye la firma del usuario.

Antes de pedir firma, mostrar entrada/salida por mint identificable, cantidad a gastar, estimación neta, mínimo neto, slippage, price impact y fuente, desglose de fees de plataforma/referral/ruta/transferencia/red/prioridad/tip/rent, red, cuenta destino y expiración. No describir gasless como coste total cero. El resumen debe provenir de la misma intención y mensaje que se firma; una cotización favorable no valida instrucciones distintas.

Mínimo neto y slippage deben contrastarse con las instrucciones y semántica del token, no solo con JSON o una fórmula sobre un precio estimado. Si el mínimo neto no puede garantizarse bajo la política admitida, bloquear esa ruta. Price impact y slippage son conceptos distintos; no presentar uno como sustituto del otro. Campos desconocidos se muestran como desconocidos o impiden firmar, según criticidad.

Modelo de estados propuesto: idle → quoting → review → awaiting signature → submitting → pending finality → succeeded / failed / expired / unknown. Rechazar una firma no activa nuevos prompts. No auto-sign, background trading, cuenta preseleccionada oculta, aumentos automáticos de slippage ni mensajes que presionen a comprar para ayudar al battlefield.

Después de firmar, no cambiar blockhash, fee payer, account metas, destino o importe. Si se necesita otro mensaje, se cancela la revisión anterior y se pide consentimiento nuevo. Un fallo HTTP después de enviar es **unknown**, no fracaso definitivo: consultar firma/red hasta un desenlace acotado. No generar otra compra mientras el resultado anterior sea desconocido. La expiración impide inclusión futura de ese mensaje, pero no deshace una inclusión anterior. Success de Jupiter tampoco activa Champion directamente.

### Seguridad de tokens y CAs arbitrarias

Token-2022 incorpora extensiones que alteran el comportamiento, entre ellas transfer fees, transfer hooks, permanent delegates, restricciones de transferencia, estado por defecto y otras.[^22] La arquitectura debe leer programa y extensiones, no asumir SPL clásico. Soporte declarado por un agregador no equivale a soporte completo por nuestro decoder/verifier.

| Evidencia comprobable | Mensaje/acción propuesta | Lo que no demuestra |
| --- | --- | --- |
| Mint authority presente | Posible aumento de oferta; identificar fuente/slot | Que necesariamente vaya a inflarse ni precio futuro |
| Freeze authority / estado congelado | Riesgo/capacidad de congelación; bloquear comportamiento no soportado | Que toda cuenta sea siempre transferible |
| Transfer fee y configuración/autoridad | Mostrar efecto neto y posibilidad de cambio; límite de soporte | Que la tarifa actual permanezca igual |
| Transfer hook, permanent delegate, confidencialidad u otra extensión no soportada | No swap/no eligibility para ese comportamiento; read-only separado | Que el token sea fraudulento por tener extensiones |
| Sin ruta o liquidez verificable; impacto extremo | No cotización ejecutable / warning con momento y fuente | Que una ruta futura permita salir o liquidez no se retire |
| Metadata no verificada/inconsistente | Mint como identidad; no badges de seguridad inventados | Autenticidad de proyecto o ausencia de scam |

Simular una venta soportada puede detectar algunos rechazos actuales, pero no garantiza vender después ni detecta toda conducta tipo honeypot. No enviar una compra/venta de prueba con fondos reales para clasificar seguridad. No ofrecer certificado «safe» por la ausencia de warnings. A/B no necesitan resolver toda seguridad de swaps: B puede rechazar evidencia que no entienda.

## 13. Tests e invariantes futuros

| Grupo | Evidencia exigida antes de un GO correspondiente |
| --- | --- |
| Control de wallet | Mensaje alterado, nonce repetido/expirado, origen/chain/mint/cuenta/sesión/firma distintos fallan; dos consumes concurrentes crean como máximo una autorización. |
| Lifecycle | Switch/lock/disconnect durante challenge, consulta y firma; múltiples cuentas; wallet tardía/ausente; no prompts al cargar, cancelar ni reconectar. |
| Verifier | Compra soportada positiva; tx inexistente/fallida/no final; firma copiada; transfer/airdrop/LP/wrap; metadata nula; LUT y CPI; cuentas creadas/cerradas; Token-2022 soportado y desconocido. |
| Replay | Tabs/instancias concurrentes, refresh, cross-mint/cross-session, crash antes/después de persistir, rotación HMAC, prune, restore de backup. Un grant como máximo; reloj nunca se reinicia. |
| Intención D | Cambiar un byte relevante, destino, mint, importe, fee, slippage, programa o LUT impide firma/envío; requote necesita revisión; timeout no provoca nueva compra. |
| Integridad mercado | Verificador aislado no tiene referencia/import/callback para emitir trades; snapshots canónicos idénticos con y sin verificación para el mismo feed. |
| Orden de llegada | Feed→verify, verify→feed, duplicados, pérdidas y reconexiones: cada evento real se aplica según dedupe normal; como máximo un grant por compra; cero synthetic events. |
| Presentación | Cambiar semilla cosmética no altera mercado; Champion no participa en fuerzas/daño/targeting; PiP cross-mint/stale descartado; snapshot falsificado no concede grant servidor. |
| Privacidad | Wallet/firma/monto ausentes en logs, analytics, URLs propias y snapshots; TTLs reales, borrado y límites de backup verificados. |
| Seguridad browser | XSS con metadata hostil, CSP y anti-frame en cada host, CSRF, headers y cookies; cliente modificado no obtiene privilegios. |

Los fixtures deterministas de CI deben etiquetarse como test y jamás entrar en fuentes de mercado de producción. LiteSVM/local validator y devnet sirven para validar mecánica, no reproducen automáticamente Jupiter/RFQ/mainnet. La disponibilidad de sandbox del proveedor debe confirmarse; no asumir que Jupiter opera un equivalente devnet. Antes de producción, pruebas manuales limitadas y explícitamente autorizadas serían otro milestone, con revisión de riesgo y sin claves reales en repositorio.

## 14. Privacidad / GDPR

### DATA MINIMISATION BY DEFAULT

**FACT:** GDPR exige finalidad, minimización, limitación temporal, licitud, transparencia y seguridad; la pseudonimización no elimina por sí sola su aplicación. La base jurídica y los derechos deben definirse según el tratamiento, no según que el dato sea público. Una evaluación de impacto es obligatoria cuando sea probable un alto riesgo.[^23]

**FACT:** EDPB Guidelines 02/2025, versión final 2.0 adoptada el 7 de julio de 2026, aborda identificadores blockchain, riesgos on/off-chain, derechos y evaluación de impacto. Su sección 4.9 mantiene el criterio de alto riesgo; no declara que toda lectura puntual de blockchain requiera automáticamente una DPIA. AEPD anunció la versión final el 9 de julio.[^24][^25]

Matiz de fuentes: el comunicado AEPD usa una formulación general de EIPD obligatoria para tratamientos con esta tecnología; el párrafo 91 del texto EDPB vincula la obligación a alto riesgo. No interpretar esa diferencia como permiso para omitir evaluación: exigir screening documentado y que asesoría de privacidad determine la aplicación concreta en España, realizando EIPD cuando proceda.[^24][^25]

**INTERPRETACIÓN TÉCNICA:** tratar conservadoramente public key, firma y sus enlaces con IP/sesión como datos personales potenciales. Incluso sin nombre civil, un claim crea una asociación entre navegación, activo y actividad económica. A no añade ese enlace; B/C/D sí. Este inventario describe incremento futuro, no afirma que el hosting read-only actual carezca de logs.

| Dato | Necesidad en B | Tratamiento mínimo propuesto | Persistencia / retention propuesta |
| --- | --- | --- | --- |
| Wallet public key | Verificar control y owner | Memoria browser mientras participa; servidor para challenge/consulta | Registro de sesión acotado 15 min; borrar al revocar/expirar; no directorio de wallets |
| Firma de mensaje | Comprobar control | Verificar y descartar bytes tras consumo | No histórico ni logging; conservar estado de challenge, no prueba completa |
| Transaction signature | Consultar tx y evitar replay | Memoria durante consulta; derivar HMAC de claim | Firma raw no persistente por defecto; marcador pseudónimo 24 h |
| IP | Transporte y defensa contra abuso | No usar como identidad de wallet; minimizar/segmentar rate limiting | Objetivo propio ≤24 h para seguridad; validar proveedor y necesidad, no prometerlo sin contrato |
| Session ID / nonce | Binding y CSRF/replay | ID opaco, cookie HttpOnly/Secure/SameSite apropiada; sin localStorage auth | Challenge 5 min; sesión 15 min; sin renovación silenciosa |
| Mint/token | Determinar ámbito | Canónico, sin historial transversal del usuario | Durante claim/grant; no analytics individual por token |
| Purchase amount | Evaluar regla si existe | Entero neto en memoria; no perfil patrimonial | Descartar tras evaluación salvo necesidad motivada y aprobada |
| Timestamp / slot | Ventana/finality/expiry | Precisión necesaria para esa decisión | Claim marker 24 h; grant hasta expiración |
| Champion eligibility | Restaurar estado autorizado | Grant opaco sin wallet pública en snapshot | Hasta expiración fijada por servidor; replay marker separado |

Estos TTLs son una propuesta técnica revisable. Si otra obligación aplicable exige conservar más, se redefine producto y lifecycle antes de implementar; no se aplica una promesa de borrado incompatible. No se construye wallet profile, balance dashboard, leaderboard de gasto, tracking de holdings ni enriquecimiento de identidad. Tampoco una tabla permanente que vincule todos los mints visitados con una public key.

El hash simple de una dirección o firma pública permite correlación por comparación. HMAC con clave protegida reduce exposición, pero sigue siendo pseudonimización mientras sea vinculable. Minimizar también tablas de recuperación, identificadores de incidentes y backups. La capacidad de soporte no justifica conservar el cuerpo completo de todas las peticiones.

Datos fuera del control directo importan: Jupiter documenta logs con IP, referrer, path/query y conservación de seis meses.[^26] Un proxy puede ocultar IP directa del visitante a Jupiter, pero no el taker/mint/importe requerido por D ni la relación temporal; tampoco obliga al proveedor a borrar. No afirmar «solo memoria» de extremo a extremo. Exigir contratos/roles, subencargados, regiones, transferencias internacionales y borrado para RPC, hosting y proveedor transaccional; no presuponer que todos sean simples encargados.

Excluir cuerpos, firmas, wallet, cookies y API keys de access logs/APM/errors; redactar query strings y cabeceras sensibles. No session replay o analytics ligados a wallet. Consentimiento de conexión/firma no es consentimiento GDPR para marketing. Informar antes de conectar y distinguir tratamiento necesario de servicios opcionales; revisar base jurídica y reglas de cookies/analytics aplicables con asesor. Ofrecer read-only sin aceptar tracking financiero.

Borrado propio: revocar sesión y grant, borrar enlaces y datos opcionales, limitar marcadores antirreplay a necesidad/plazo justificados y comunicar cualquier excepción. No prometer borrar una transacción de Solana ni escribir un hash personal en cadena para «cumplir GDPR». El diseño no necesita registrar nuevo dato personal on-chain. Procedimiento para acceso/supresión sin pedir documento civil por defecto, verificación proporcional del solicitante y conservación restringida de incidencias.

**OPEN PRIVACY QUESTIONS:** responsable y posibles corresponsables; base jurídica por finalidad; validez/necesidad de consentimientos; retention contractual real; derecho de supresión frente a fraude; transferencias fuera del EEE; menores y profiling. Screening DPIA antes de código wallet, escalando si hay observación sistemática, gran escala, correlación de datos financieros, colectivos vulnerables o funciones adicionales. Si persiste alto riesgo no mitigable, evaluar consulta previa con autoridad y no lanzar. Champion cosmético no implica por sí solo decisión automatizada de efecto significativo; valorar de nuevo si condiciona servicios o recompensas económicas.

## 15. España / UE: análisis regulatorio

### Hechos y alcance de la interpretación

**FACT:** MiCA define servicios concretos; custodia comprende salvaguardar/controlar activos o medios de acceso. Exchange, execution, recepción/transmisión y transfer tienen definiciones diferentes; arts. 59–60 regulan habilitación para prestar servicios. Las exclusiones dependen del activo/actividad, no de llamarse una UI.[^27][^28]

**FACT:** ESMA Q&A 2653, respuesta de 14 de octubre de 2025, exige atender a la realidad operativa: contraparte, agente que concluye acuerdos o transmisión a terceros. La etiqueta contractual/comercial no decide por sí sola.[^29]

**FACT:** CNMV señala que desde el 1 de julio de 2026 solo pueden operar en España proveedores habilitados conforme al régimen aplicable. El periodo transitorio español está terminado en la fecha de este gate; no sirve como vía para una funcionalidad nueva.[^30]

**INTERPRETACIÓN TÉCNICA:** no custodiar claves reduce una categoría de riesgo, pero no resuelve execution/RTO/transfer. Tampoco consultar una transacción convierte automáticamente a Frontline en exchange. El análisis depende de quién recibe la intención, configura condiciones, escoge destino/ruta, transmite mensajes y cobra, además del contexto comercial.

### Matriz de capacidades

Confianza = confianza en la **relevancia del punto para revisión**, no certeza de una calificación legal de Frontline. Las filas son hipótesis funcionales que el asesor debe validar con diagramas y UX exactos.

| Capability | Potential regulatory relevance | Confidence | Legal review needed |
| --- | --- | --- | --- |
| A: visualización no personalizada de mercado | Más alejada de ejecutar/intermediar órdenes; publicidad/servicios de datos siguen siendo cuestiones propias | MEDIUM | Antes de monetizar/promocionar; no se certifica exención general |
| B: connect + prueba de control sin órdenes | Identificación técnica no parece por sí misma exchange/custodia; finalidad comercial y privacidad importan | MEDIUM | Sí, antes de código wallet |
| B: validar compra pasada para cosmético | Menor proximidad a ejecución si no participa en la operación; incentivo de compra requiere análisis | MEDIUM | Sí: promoción, incentivos, condiciones de acceso y público |
| C: enlace general sin orden ni parámetros privados | Más distancia técnica de RTO; relación comercial/afiliación puede cambiar evaluación | MEDIUM | Sí: destino, comunicaciones y remuneración |
| C: mint/importe/ruta preconfigurados o deep link de compra | Puede acercarse a recepción/transmisión o promoción; depende de qué se recibe y transmite | HIGH | Sí, con flujo exacto; no asumir escape por redirect |
| D: quote personalizado y tx para firma | Posible ejecución/RTO según papel en conclusión/transmisión de la orden | HIGH | Esencial, previa a diseño implementable |
| D: transmitir tx firmada o llamar execute | Mayor proximidad a ejecución/transfer según flujo y contratos | HIGH | Esencial; non-custodial no basta |
| Actuar como contraparte con capital propio | Relevancia de exchange, distinta a enrutar operaciones | HIGH | Esencial; no previsto ni autorizado |
| Controlar claves, delegated spend o activos del usuario | Relevancia directa de custodia/control; prohibido en las opciones iniciales | HIGH | Esencial si se propusiera; reabrir todo el gate |
| Transferir activos entre direcciones por cuenta de usuario | Transfer services; relación con otros servicios a clasificar | HIGH | Esencial; no previsto para B/C |
| Fees por swap / referral / mejores rutas promovidas | Conflictos, incentivos y modelo de intermediación; no concede ni elimina autorización por sí solo | HIGH | Esencial antes de cobrar o introducir enlaces remunerados |

No hay dictamen «Frontline necesita licencia» ni «Frontline es legal». Aplazar no depende de demostrar ninguna de esas dos proposiciones. La matriz identifica exposición relativa y preguntas abiertas.

### Preguntas para asesoría especializada

1. ¿Cuál es la entidad operadora, establecimiento, público objetivo y prestación profesional? ¿Qué activos quedarían bajo MiCA y cuáles bajo otro régimen, por ejemplo instrumentos financieros? La aceptación de CAs arbitrarias impide presumir una clasificación uniforme.
2. Para B exacta, ¿verificar una operación pasada para un cosmético es un servicio cripto regulado, comunicación promocional u otra actividad relevante? ¿Cambian la respuesta mínimo de compra, duración, renovaciones o recompensas?
3. Para C, ¿qué parámetros/selección/afiliación cruzan hacia RTO, ejecución o promoción? ¿Qué entidad presta el servicio externo y está habilitada para usuarios españoles? No asumir que un proveedor fuera del EEE puede ampararse en reverse solicitation por un enlace promovido desde Frontline.
4. Para D, mapear recepción de intención, quote, firma, execute, routing, fees, contraparte y destino a categorías aplicables. ¿Qué contratos/autorizaciones serían necesarios? ¿Procedería consulta a CNMV tras análisis profesional?
5. ¿Qué obligaciones de consumo, publicidad financiera/cripto, conflictos, menores y accesibilidad corresponden a una experiencia gamificada vinculada a compra? No usar disclaimer para sustituir requisitos materiales.
6. Si se calificase un servicio regulado, ¿qué obligaciones adicionales de prevención de blanqueo, transferencias, registros, resiliencia y atención de reclamaciones resultarían aplicables? No diseñar excepciones sin revisión.

La revisión jurídica debe dejar un memo fechado sobre la variante exacta, preguntas resueltas y límites operativos. Cambiar fees, destinatario, routing, países o incentivos invalida esa aprobación hasta revisión. Una autorización del proveedor externo no se hereda automáticamente por Frontline.

## 16. Gates GO / NO-GO

Cada gate tiene propietario propuesto y evidencia verificable. **Cualquier gate esencial no satisfecho implica NO-GO de implementación wallet.** Este documento prepara revisión; no simula aprobaciones humanas.

| Gate esencial | Evidencia requerida | Responsable propuesto | Estado M9.0 |
| --- | --- | --- | --- |
| PRODUCT | Hipótesis B2C y beneficio validados frente a mejoras visuales; alcance mínimo aprobado, sin inducir trading compulsivo | Product owner | NO-GO: valor incremental no validado |
| LEGAL | Memo profesional España/UE del flujo exacto, proveedor y remuneración; sin cuestiones críticas abiertas | Asesor especializado + operador | NO-GO: revisión pendiente |
| PRIVACY | Inventario/roles/bases/retention/contratos, derechos, screening DPIA y DPIA si procede; datos de terceros incluidos | Responsable privacidad | NO-GO: diseño propuesto, no aprobado |
| SECURITY | Revisión independiente de protocolo y threat model; riesgos altos resueltos/aceptados justificadamente; plan XSS/incidentes | Security reviewer | NO-GO: no auditado |
| ARCHITECTURE | Auth y autoridad servidor, consumo atómico, policy/grant, separación mercado; ADR de implementación aprobado | Maintainer técnico | NO-GO: contrato conceptual solamente |
| OPERATIONS / COMPATIBILITY | Presupuesto, SLAs, proveedores revisados, kill switch, logging, matriz Phantom/Solflare/Backpack y estrategia de pruebas | Operador + QA | NO-GO: pendiente |

Si algún gate cambia a GO, no activa los demás. A no necesita abrir wallet para validar demanda: entrevistas, maquetas no funcionales y personalización read-only son posibles en un milestone autorizado separado. Para D harían falta además revisión de mensajes/programas/rutas y UX de consentimiento transaccional; aprobar B no autoriza D.

## 17. Monetización, portfolio y Commander roadmap

**B2B:** perfiles oficiales, themes, Commander Profiles, personalización y branded Frontline pueden venderse como trabajo/software/presentación sin wallet de usuario final. «Oficial» exige autorización verificable del proyecto y derechos sobre marca/assets; no es badge de solvencia del token. Evitar que un cliente que paga altere métricas, presión, ranking factual o elegibilidad de compras.

**B2C:** B permitiría una interacción verificada sin swap integrado, pero no demuestra demanda pagada ni rentabilidad. C añade adquisición/afiliación; D puede añadir fees por actividad, junto con conflictos y mantenimiento. Wallet integrada no es requisito de monetización. No lanzar token, NFT, sistema de puntos monetarios o custodia como atajo de ingresos.

**Portfolio:** A acompañada de este registro de decisión muestra límites y criterio profesional. B podría aportar valor técnico real si se justificase y probase. C no es automáticamente simple porque redirija; D incompleta, sin revisión o con callback→grant, perjudicaría la calidad. Un solo documento central encaja con `/docs`; un ADR independiente tendrá sentido cuando exista una decisión implementable, no para duplicar este gate.

**Siguiente milestone recomendado: Battlefield Motion / Combat / Commander Profiles, antes de wallet.** Alcance conceptual pendiente:

- `canonical mint -> CommanderProfile` publicado/validado; no selección por ticker, metadata o wallet.
- Black Bull King exclusivo de ANSEM; token genérico sin King salvo profile publicado. Es objetivo futuro, no certificación de todos los comportamientos actuales.
- Custom project commanders, incluido TripleT cuando tenga perfil/assets autorizados.
- Corrección stuck/facing, locomoción y gait de patas bull; ataques bear rear-up/claw; giant bull charge/knockback; legibilidad de batalla basada en datos reales.
- CommanderProfile controla identidad/presentación y comportamiento visual permitido, no ChampionPolicy, identidad wallet, precio, feeds ni fuentes de fuerza ficticia.

Separar tres dimensiones: CommanderProfile del token, ThemeDefinition visual y entitlement personal de User Champion. La compra no convierte al visitante en el comandante del proyecto. Mejorar animación no debe convertir una acción de combate programada en supuesto flujo de mercado.

## 18. Fuentes y vigencia

Todas las fuentes son primarias/oficiales y fueron consultadas el **12-09-2026**. Documentación técnica sin fecha editorial se marca «viva» y debe revisarse de nuevo antes de código; rutas, capacidades, tarifas, límites y semántica API cambian rápidamente. Fechas legales son de los instrumentos/respuestas, no promesa de ausencia de futuras modificaciones. Se consultaron EUR-Lex, ESMA y CNMV conjuntamente; la clasificación final requiere revisión jurídica vigente al lanzamiento.

| Source | Authority | Date/currentness | Used for |
| --- | --- | --- | --- |
| [1. Frontend](https://solana.com/docs/frontend) | Solana | Viva; consulta 12-09-2026 | Kit y plugins |
| [2. Migrating to Kit](https://solana.com/docs/frontend/web3-compat) | Solana | Viva; consulta 12-09-2026 | Legado, compatibilidad y Wallet Standard |
| [3. Wallet Standard](https://github.com/wallet-standard/wallet-standard/blob/master/README.md) | Mantenedores del estándar | Rama master viva | Registro, interfaces, descubrimiento |
| [4. Solana wallet example](https://github.com/wallet-standard/wallet-standard/blob/master/packages/example/wallets/src/solanaWallet.ts) | Mantenedores del estándar | Ejemplo vivo, no matriz universal | Capacidades por cuenta, firma y eventos |
| [5. Wallet Standard](https://docs.phantom.com/developer-powertools/wallet-standard) | Phantom | Viva | Soporte estándar |
| [6. Sign a message](https://docs.phantom.com/solana/signing-a-message) | Phantom | Viva | Firma de mensaje |
| [7. Integrate Solflare](https://docs.solflare.com/solflare/technical/integrate-solflare) | Solflare | Viva | Alternativas de integración |
| [8. SignMessage](https://docs.solflare.com/solflare/technical/deeplinks/provider-methods/signmessage) | Solflare | Viva | Mensaje visible, flujo móvil |
| [9. SignMessage](https://docs.backpack.app/deeplinks/provider-methods/signmessage) | Backpack | Texto oficial indexado; apertura directa falló; sin fecha editorial confirmada | Flujo móvil de firma, no certificación de extensión |
| [10. Handling Sessions](https://docs.backpack.app/deeplinks/handling-sessions) | Backpack | Texto oficial indexado; sin fecha editorial confirmada | Sesión de proveedor distinta de auth Frontline |
| [11. RPC overview](https://solana.com/docs/rpc) | Solana | Viva | Red, commitments y RPC público |
| [12. Confirmation & Expiration](https://solana.com/developers/cookbook/transactions/confirmation) | Solana | Viva | Firmas, blockhash y expiración |
| [13. simulateTransaction](https://solana.com/docs/rpc/http/simulatetransaction) | Solana | Viva | Límites de simulación |
| [14. getTransaction](https://solana.com/docs/rpc/http/gettransaction) | Solana | Viva | Evidencia RPC, metadata y versiones |
| [15. LiteSVM](https://solana.com/docs/tools/litesvm) | Solana | Viva | Pruebas locales |
| [16. Swap overview](https://developers.jup.ag/docs/swap) | Jupiter | Viva; contradicción keyless con Portal | Swap V2 y variantes |
| [17. Order & Execute](https://developers.jup.ag/docs/swap/order-and-execute) | Jupiter | Viva; alto ritmo de cambio | Flujo, expiry, resultados y fees |
| [18. Slippage Estimation](https://developers.jup.ag/docs/swap/advanced/slippage) | Jupiter | Viva | RTSE |
| [19. Documentation index](https://developers.jup.ag/docs/llms.txt) | Jupiter | Vivo; contrastado con páginas específicas | Migración y capacidades anunciadas MEV/landing |
| [20. Portal setup](https://developers.jup.ag/docs/portal/setup) | Jupiter | Viva | Keyless, API key y discrepancia de overview |
| [21. Metis fee guide (legacy)](https://developers.jup.ag/docs/swap/v1/add-fees-to-swap) | Jupiter | Marcada no mantenida / sustituida | Evitar diseño nuevo en v1 |
| [22. Token Extensions](https://solana.com/docs/tokens/extensions) | Solana | Viva | Token-2022 y límites de soporte |
| [23. Reglamento (UE) 2016/679](https://eur-lex.europa.eu/legal-content/EN/TXT/?qid=1640080938208&uri=CELEX%3A32016R0679) | EUR-Lex / UE | 27-04-2016; texto consultado | GDPR arts. 5, 6, 12–22, 25, 28, 32, 35–36 y transferencias |
| [24. Guidelines 02/2025, v2.0](https://www.edpb.europa.eu/system/files/2026-07/edpb_guidelines_202502_blockchain_v2_en.pdf) | EDPB | Adoptadas 07-07-2026, final tras consulta | Identificabilidad, riesgos on/off-chain, DPIA |
| [25. Anuncio de directrices finales](https://www.aepd.es/prensa-y-comunicacion/notas-de-prensa/comite-europeo-proteccion-datos-aprueba-directrices-tratamiento-mediante-blockchain) | AEPD | 09-07-2026 | Corroboración versión final; no usar borrador 2025 |
| [26. Request Logs](https://developers.jup.ag/docs/portal/logs) | Jupiter | Viva | Campos y retention de terceros |
| [27. Reglamento (UE) 2023/1114](https://eur-lex.europa.eu/legal-content/EN/TXT/?qid=1686302733527&uri=CELEX%3A32023R1114) | EUR-Lex / UE | 31-05-2023; texto consultado | MiCA, ámbito, habilitación y servicios |
| [28. MiCA Article 3](https://www.esma.europa.eu/publications-and-data/interactive-single-rulebook/mica/article-3-definitions) | ESMA | Single rulebook vivo | Definiciones de categorías |
| [29. Q&A 2653](https://www.esma.europa.eu/publications-data/questions-answers/2653) | ESMA | Respuesta 14-10-2025; pregunta 08-11-2024 | Realidad operativa vs etiquetas |
| [30. MiCA: regulación de criptoactivos](https://www.cnmv.es/Portal/mica/regulacion-criptoactivos?lang=es) | CNMV | Consulta 12-09-2026; transición finalizada 01-07-2026 | Situación española |

[^1]: Solana, [Frontend](https://solana.com/docs/frontend).
[^2]: Solana, [Migrating to Kit](https://solana.com/docs/frontend/web3-compat).
[^3]: Wallet Standard, [README y contratos](https://github.com/wallet-standard/wallet-standard/blob/master/README.md).
[^4]: Wallet Standard, [ejemplo Solana](https://github.com/wallet-standard/wallet-standard/blob/master/packages/example/wallets/src/solanaWallet.ts).
[^5]: Phantom, [Wallet Standard](https://docs.phantom.com/developer-powertools/wallet-standard).
[^6]: Phantom, [Sign a message](https://docs.phantom.com/solana/signing-a-message).
[^7]: Solflare, [Integrate Solflare](https://docs.solflare.com/solflare/technical/integrate-solflare).
[^8]: Solflare, [SignMessage](https://docs.solflare.com/solflare/technical/deeplinks/provider-methods/signmessage).
[^9]: Backpack, [SignMessage](https://docs.backpack.app/deeplinks/provider-methods/signmessage), texto oficial indexado.
[^10]: Backpack, [Handling Sessions](https://docs.backpack.app/deeplinks/handling-sessions), texto oficial indexado.
[^11]: Solana, [RPC overview](https://solana.com/docs/rpc).
[^12]: Solana, [Confirmation & Expiration](https://solana.com/developers/cookbook/transactions/confirmation).
[^13]: Solana, [simulateTransaction](https://solana.com/docs/rpc/http/simulatetransaction).
[^14]: Solana, [getTransaction](https://solana.com/docs/rpc/http/gettransaction).
[^15]: Solana, [LiteSVM](https://solana.com/docs/tools/litesvm).
[^16]: Jupiter, [Swap overview](https://developers.jup.ag/docs/swap).
[^17]: Jupiter, [Order & Execute](https://developers.jup.ag/docs/swap/order-and-execute).
[^18]: Jupiter, [Slippage Estimation](https://developers.jup.ag/docs/swap/advanced/slippage).
[^19]: Jupiter, [índice oficial de documentación](https://developers.jup.ag/docs/llms.txt).
[^20]: Jupiter, [Portal setup](https://developers.jup.ag/docs/portal/setup).
[^21]: Jupiter, [guía legacy Metis](https://developers.jup.ag/docs/swap/v1/add-fees-to-swap).
[^22]: Solana, [Token Extensions](https://solana.com/docs/tokens/extensions).
[^23]: EUR-Lex, [Reglamento (UE) 2016/679](https://eur-lex.europa.eu/legal-content/EN/TXT/?qid=1640080938208&uri=CELEX%3A32016R0679).
[^24]: EDPB, [Guidelines 02/2025 v2.0](https://www.edpb.europa.eu/system/files/2026-07/edpb_guidelines_202502_blockchain_v2_en.pdf), 07-07-2026, especialmente §§3.2, 4.7, 4.9 y 5.
[^25]: AEPD, [anuncio](https://www.aepd.es/prensa-y-comunicacion/notas-de-prensa/comite-europeo-proteccion-datos-aprueba-directrices-tratamiento-mediante-blockchain), 09-07-2026.
[^26]: Jupiter, [Request Logs](https://developers.jup.ag/docs/portal/logs).
[^27]: EUR-Lex, [Reglamento (UE) 2023/1114](https://eur-lex.europa.eu/legal-content/EN/TXT/?qid=1686302733527&uri=CELEX%3A32023R1114), especialmente arts. 2–3, 59–61, 77–82 y 143.
[^28]: ESMA, [MiCA Article 3](https://www.esma.europa.eu/publications-and-data/interactive-single-rulebook/mica/article-3-definitions).
[^29]: ESMA, [Q&A 2653](https://www.esma.europa.eu/publications-data/questions-answers/2653), respuesta 14-10-2025.
[^30]: CNMV, [MiCA: regulación de criptoactivos](https://www.cnmv.es/Portal/mica/regulacion-criptoactivos?lang=es).

## 19. Registro de decisión

Opción elegida para la siguiente fase: A. B se conserva como alternativa condicionada, no como aprobación limitada. C/D quedan diferidas. Reabrir este gate si se valida necesidad B2C, cambian requisitos económicos, aparece un socio/proveedor revisado o se modifica el flujo propuesto. Actualizar fuentes y cerrar todos los gates antes de cualquier código wallet.

El artefacto M9.0 es exclusivamente este documento; no añade runtime ni cambia dependencias. El siguiente milestone recomendado es Battlefield Motion / Combat / Commander Profiles. Su ejecución requiere una solicitud separada y no forma parte de este gate.

M9.0 GATE RECOMMENDS DEFERRING WALLET
