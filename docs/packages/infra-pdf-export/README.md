# @intexuraos/infra-pdf-export

`@intexuraos/infra-pdf-export` renders already-authorized, already-redacted conversation snapshots into PDF files.

Consumers provide the title, source range, message counts, optional omitted-message breakdown, and chronological user/assistant messages. The package returns PDF bytes, an `application/pdf` content type, and a sanitized full filename including the `.pdf` extension.
