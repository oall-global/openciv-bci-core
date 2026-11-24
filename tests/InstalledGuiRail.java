import java.io.*;
import java.lang.reflect.*;
import sun.misc.Unsafe;
// Calls the installed GUI's original compiled DataStatus.update, not a port.
// Only hardware metadata is stubbed; no constructor/device connection is run.
public class InstalledGuiRail {
  static int rate; static double gain; static boolean streaming;
  static class Stub extends OpenBCI_GUI.BoardCytonWifiDaisy {
    Stub(OpenBCI_GUI outer){outer.super();}
    public int getSampleRate(){return InstalledGuiRail.rate;}
    public double getGain(int channel){return InstalledGuiRail.gain;}
    public boolean isStreaming(){return InstalledGuiRail.streaming;}
  }
  public static void main(String[] args) throws Exception {
    Field uf=Unsafe.class.getDeclaredField("theUnsafe");uf.setAccessible(true);Unsafe unsafe=(Unsafe)uf.get(null);
    OpenBCI_GUI gui=(OpenBCI_GUI)unsafe.allocateInstance(OpenBCI_GUI.class);
    Stub stub=(Stub)unsafe.allocateInstance(Stub.class);
    Field board=OpenBCI_GUI.class.getDeclaredField("currentBoard");board.setAccessible(true);board.set(gui,stub);
    OpenBCI_GUI.DataStatus status=gui.new DataStatus();
    try(DataInputStream in=new DataInputStream(new BufferedInputStream(new FileInputStream(args[0])));
        PrintWriter out=new PrintWriter(args[1])){
      int count=in.readInt();
      for(int c=0;c<count;c++){
        rate=in.readInt();gain=in.readDouble();streaming=in.readBoolean();int length=in.readInt();float[] x=new float[length];
        for(int i=0;i<length;i++)x[i]=in.readFloat();
        status.update(x,0);
        String state=status.notificationString.contains("doesn't change")?"flat":status.is_railed?"railed":status.is_railed_warn?"near":"normal";
        out.println(c+","+state+","+status.getPercentage()+","+status.notificationString);
      }
    }
  }
}
