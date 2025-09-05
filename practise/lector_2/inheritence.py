class Car():
    def __init__(self, type):
        self.type = type

    @staticmethod
    def start():
        print("Start the Car")

class Toyota(Car):
    def __init__(self, name ,type):
        super().__init__(type)
        self.name = name

c1 = Toyota("prius", "electric")
print(c1.start())
        