class Person:
    name = "anonymous"

    # def changename(self, name):
    #     self.name = name 

    @classmethod
    def changename(cls, name):
        cls.name = name

n1 = Person()
n1.changename("RahulKumar")
print(n1.name)
print(Person.name)