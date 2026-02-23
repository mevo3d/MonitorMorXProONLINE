import PyPDF2
import sys

def extract_text(pdf_path):
    text = ""
    try:
        with open(pdf_path, 'rb') as file:
            reader = PyPDF2.PdfReader(file)
            for page in reader.pages:
                text += page.extract_text() + "\n"
        with open("C:/Users/BALERION/proyectos-automatizacion/MonitorMorXProONLINE/pdf_extracted.txt", "w", encoding="utf-8") as f:
            f.write(text)
        print("Success")
    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    extract_text("C:/Users/BALERION/Downloads/SÍNTESIS DE PRENSA 20 DE FEBRERO 2026- CONGRESO.pdf")
