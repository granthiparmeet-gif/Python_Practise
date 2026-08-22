class Circle():
    def __init__(self, radius):
        self.radius = radius

    def perimeter(self):
        print(f"Permiter is {2*3.14*self.radius :.2f}")

    def area(self):
        print(f"Area is {3.14*self.radius*self.radius : .2f}")

c1 = Circle(3)
c1.perimeter()
c1.area()