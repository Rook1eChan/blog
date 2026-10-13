.PHONY: all build serve clean

all: build

build:
	python3 -c "from generator.commands import main_build; main_build()"

serve:
	python3 -c "from generator.commands import main_serve; main_serve()"

clean:
	rm -rf _build
