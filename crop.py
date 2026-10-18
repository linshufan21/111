from PIL import Image
im=Image.open("screenshots/admin-questions.png")
im.crop((150,220,380,350)).resize((460,260)).save("screenshots/_crop.png")
