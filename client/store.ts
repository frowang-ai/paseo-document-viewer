import { createDocumentStore } from "../shared/document-state";
import { readDocumentSessions, writeDocumentSessions } from "./web";
export const documents = createDocumentStore({
  read: readDocumentSessions,
  write: writeDocumentSessions,
});
