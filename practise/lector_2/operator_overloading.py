class Complex():
    def __init__(self, real, img):
        self.real = real
        self.img = img

    def show_number(self):
        print(f"{self.real}i + {self.img}j")

    def __add__(self, num2):
        newreal = self.real + num2.real
        newImg = self.img + num2.img
        return Complex(newreal,newImg)


num1 = Complex(3,4)
num1.show_number()

num2 = Complex(5,3)
num2.show_number()

num3 = num1 + num2
num3.show_number()
