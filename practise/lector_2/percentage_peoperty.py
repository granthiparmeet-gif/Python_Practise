class Student:
    def __init__(self, physics, chemistry, maths):
        self.physics = physics
        self.chemistry = chemistry
        self.maths = maths

    @property
    def percentage(self):
        average = (self.physics + self.chemistry + self.maths) / 3
        return f"{average: .2f}"
    
s1 = Student(93,87,34)
print(s1. percentage)

s1.physics = 72
print(s1.percentage)