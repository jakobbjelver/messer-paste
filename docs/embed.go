// Package docs embeds the public contract: the OpenAPI document and the plain-text primer an agent
// fetches first. They live in docs/ because that is where the estate standard puts the contract.
package docs

import _ "embed"

//go:embed openapi.json
var OpenAPI []byte

//go:embed llms.txt
var LLMS []byte
