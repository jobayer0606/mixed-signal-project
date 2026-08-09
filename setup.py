from setuptools import setup, find_packages

setup(
    name="pyaudiolab",
    version="0.1.0",
    description="A lightweight Python audio effects editor",
    packages=find_packages(),
    python_requires=">=3.8",
    install_requires=[
        "numpy>=1.24",
        "scipy>=1.11",
        "soundfile>=0.12",
        "matplotlib>=3.7",
        "fastapi>=0.110",
        "uvicorn[standard]>=0.29",
        "python-multipart>=0.0.9",
    ],
    extras_require={
        "mp3": [
            "pydub>=0.25",
            "audioop-lts>=0.2; python_version >= '3.13'",
        ],
    },
    entry_points={
        "console_scripts": [
            "pyaudiolab=pyaudiolab.cli:main",
        ],
    },
)
