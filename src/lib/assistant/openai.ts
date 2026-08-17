// Alias temporal para integraciones internas antiguas. El cliente y el routing
// viven en la capa desacoplada de IA; este archivo ya no inicializa proveedores.
export { answerWithAi as answerWithOpenAI } from "@/lib/assistant/ai";
