ROOT := $(shell git rev-parse --show-toplevel)
dev validate: ; $(MAKE) -s -C $(ROOT) $@-mealrot
