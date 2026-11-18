// CommonJS entry point expected by the Cloud Functions Node.js loader.
// The implementation and official YDB SDK use ES modules.
/** @type {typeof import('./index.mjs').handler} */
exports.handler = async (event, context) => {
  const { handler } = await import('./index.mjs');
  return handler(event, context);
};
