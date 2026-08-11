setup:
	python -m pip install --upgrade pip
	python -m pip install -r requirements.txt

check:
	python -m compileall matcher simulator

test:
	python -m pytest -q

simulator:
	python simulator/run_simulation.py

benchmark:
	python simulator/run_simulation.py --benchmark
