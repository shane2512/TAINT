.PHONY: test setup replay cosign-demo redteam mandate-demo web

test:
	npm test

replay:
	npm run replay --silent -- $(ARGS)

setup cosign-demo redteam mandate-demo web:
	@echo "$@: not yet implemented"
