"""Build and run actual C consumer against native dynamic library. Unix CI test."""
import os,sys,subprocess,tempfile,pathlib
root=pathlib.Path(__file__).resolve().parents[2]
lib=pathlib.Path(os.environ["RIGLYPH_NATIVE_LIB"]).resolve()
if not lib.exists():
 raise RuntimeError("Native library unavailable")
with tempfile.TemporaryDirectory(prefix="riglyph c consumer ") as temp:
 exe=pathlib.Path(temp)/"native-consumer"
 cmd=["cc","-std=c11","-O2","-I",str(root/"native/include"),str(root/"examples/native-renderer/native-consumer.c"),
      str(lib),"-o",str(exe)]
 if sys.platform.startswith("linux"):
  cmd+=["-Wl,-rpath,"+str(lib.parent)]
 subprocess.run(cmd,check=True)
 subprocess.run([str(exe)],check=True)
